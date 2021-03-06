/* this node script is run at every :58, called by cron
   for example, if it is run at 15:58, it will check to
   see if there is a show scheduled to start at 16:00.
   if so, it will begin recording that show at 16:00, and
   stop recording when the show ends. It will attempt to get the playlist
   id of the show's current playlist at 2-minutes until it stops
   recording. So, if it was a one hour show, it'd grab the playlist at
   16:58. If it was successful, it renames the mp3 to playlist-id.mp3 and
   will upload the file to cloud storage, and also move it to a place
   on the local file system. If there was no playlist found, a default
   name is used, and the file is not uploaded to cloud storage.

   If there's no show scheduled to start in the next hour, the program terminates.
*/


let spinitron = require('./spinitron.js'),
    shelljs = require('shelljs'),
    later = require('later'),
    moment = require('moment'),
    scheduler = require('node-schedule'),
    b2 = require('backblaze-b2'),
    path = require('path'),
    fs = require('fs');

/* streamripper opts */
const RECORDING_PROGRAM = 'streamripper';
const RECORDING_URL = 'http://ksdt.ucsd.edu:8000/stream';
const RECORDING_DIR = "./temp_recordings";
const RECORDING_OPTS = `-d ${RECORDING_DIR} -s -A -a`;
const FINISHED_DIR = "./ps";

b2 = new b2({
    accountId: process.env.B2ACCTID,
    applicationKey: process.env.APPKEY
});

const B2_BUCKET = process.env.B2BUCKET;

spinitron.getUpcomingShowInfo().then(show => {
    /* schedule recording to start at the top of the hour */
    let recordingStartTime = later.hour.end(new Date());
    scheduler.scheduleJob(recordingStartTime, record.bind(null, show));

    console.log( timestamp(show),
        "Scheduled recording to start at",
        moment(recordingStartTime).format('hh:mma dddd MMMM Qo'),
        "for show",
        show['ShowName']
    );

}).catch(error => {
    console.error(timestamp(), error);
    /* there is no show scheduled to start next hour. */
    /* since there is no show, we don't need to do anything. */
    //process.exit();
});

/* called at the top of the hour when a show starts */
let record = function(show) {

    let filename = Date.now(); /* temporary filename */

    /* prepare streamripper command */
    const RECORDING_TIME = `${show.duration * 60 * 60 + 120}`; /* hours -> seconds + two minutes */
    //const RECORDING_TIME = '5'
    const RECORDING_SCRIPT =
        `${RECORDING_PROGRAM} ${RECORDING_URL} -l ${RECORDING_TIME} ${RECORDING_OPTS} "${filename}"`

    console.log( timestamp(show),
        "Starting to record",
        show['ShowName'],
        "for",
        RECORDING_TIME,
        "seconds."
    );

    /* create a promise for playlistID */
    let getPlaylistID = new Promise((function(show, resolve, reject)  {
        var playlistFetchTime;
        let diff = moment(show['OffairTime'], 'HH:m:s').diff(
                       moment(show['OnairTime'], 'HH:m:s'),
                       'hours'
                   );
        if (diff < 0) { /* show went into new day */
            playlistFetchTime = moment(show['OffairTime'], 'HH:m:s').add(1, 'day').subtract(2, 'minutes');
        } else {
            playlistFetchTime = moment(show['OffairTime'], 'HH:m:s').subtract(2, 'minutes');
        }
        console.log(timestamp(), "Scheduled playlist fetch for", playlistFetchTime.format('HH:mm:ss'));
        scheduler.scheduleJob(playlistFetchTime.toDate(), function() {
            spinitron.getCurrentPlaylist(show)
                .then(playlist => {
                    console.log( timestamp(show),
                        "Successfully fetched current playlist: ", playlist['PlaylistID']
                    );
                    resolve(playlist)
                }, error => {
                    console.error( timestamp(show),
                        "Failed to fetch current playlist: ", error
                    );
                    reject(error);
                })
        });
    }).bind(null, show));

    /* Begin recording */
    shelljs.exec(RECORDING_SCRIPT, {
        silent: true
    }, (function(filename, show, getPlaylistID, code, stdout, stderr) {
            /* recording finished! */
            console.log(timestamp(show), "Recording finished.");

            if (code != 0) {
                console.error(timestamp(show), "streamripper terminated with non-zero code", code);
                console.error(timestamp(show), "STDOUT", stdout);
                console.error(timestamp(show), "STDERR", stderr);
            }

            getPlaylistID /* should already be resolved */
                .then(playlist => {
                    /* playlist found */
                    shelljs.mv(`${RECORDING_DIR}/${filename}.mp3`,
                        `${FINISHED_DIR}/${playlist['PlaylistID']}.mp3`);
                    console.log(timestamp(show),
                        "Moved",
                        `${RECORDING_DIR}/${filename}.mp3 -> ${FINISHED_DIR}/${playlist['PlaylistID']}.mp3`
                    );
                    backup(show, `${FINISHED_DIR}/${playlist['PlaylistID']}.mp3`);
                }, error => {
                    /* playlist not found - default name ShowID-M-D-Y.mp3*/
                    shelljs.mv(`${RECORDING_DIR}/${filename}.mp3`,
                        `'${FINISHED_DIR}/${show['ShowID']}-${moment().format('M-D-Y')}.mp3'`);
                    console.log(timestamp(show),
                        "Moved",
                        `${RECORDING_DIR}/${filename}.mp3 -> ${FINISHED_DIR}/${show['ShowID']}-${moment().format('M-D-Y')}.mp3`
                    );
                    backup(show, `${FINISHED_DIR}/${show['ShowID']}-${moment().format('M-D-Y')}.mp3`);
                });


    }).bind(null, filename, show, getPlaylistID));
};

/* utility to generate timestamps */
let timestamp = function(show) {
    return `[${moment().format('HH:mm:ss')}${show ? " - " + show['ShowName'] : ""}]`;
}

/* backs up file to b2 */
let backup = function(show, filename) {
    return new Promise((resolve, reject) => {
        b2.authorize().then(
            (resp) => {
                b2.getUploadUrl(B2_BUCKET).then(
                        (response) => {
                            fs.readFile(filename, function(err, data) {
                                console.log("uploadUrl", response.data.uploadUrl)
                                console.log("uploadAuthToken", response.data.authorizationToken)
                                console.log("filename", path.basename(filename))
                                b2.uploadFile( {
                                    uploadUrl: response.data.uploadUrl,
                                    uploadAuthToken: response.data.authorizationToken,
                                    filename: encodeURIComponent(path.basename(filename)),
                                    data: data,
                                    info : {
                                        show: show['ShowName'],
                                        sid: show['ShowID']
                                    },
                                    onUploadProgress: function(evt) {
                                        console.log(evt);
                                    }
                                }).then(
                                    (resp) => { console.log(timestamp(show), 'Successfully uploaded.'); resolve(resp); },
                                    (error) => {console.error(timestamp(show), '[UPLOAD ERROR]:', error); reject(error); }
                                );
                            });
                        },
                        (error) => { console.log(timestamp(show), '[authorize error]:', error); }
                );
            },
            (error) => { console.log(timestamp(show), '[authorize error]:', error); }
        );
    });
};
backup({ShowName: "Drink Me Mix-tape", sid: 342}, "./ps/11138.mp3")
