let spinitron = require('spinitron-spinpapi');
let moment = require('moment');

spinitron = new spinitron({
                    station: 'ksdt',  /* optional */
                    userid: 'x',
                    secret: 'x'
            });

/* gets the ON AIR playlist. */
let getCurrentPlaylist = function(show) {
    return new Promise((resolve, reject) => {
        spinitron.getCurrentPlaylist(function(error, response) {
            if (error) {
                reject(error);
            } else if (!response.success){
                reject("Spinitron request was unsuccessful.");
            } else {
                spinitron.getPlaylistInfo({'PlaylistID': response.results}, function(error, response) {
                    if (error) {
                        reject(error);
                    } else if (!response.success){
                        reject("Spinitron request was unsuccessful.");
                    } else if (response.results['ShowID'] != show['ShowID']) {
                        reject("The current show does not own the current playlist");
                    } else {
                        resolve(response.results)
                    }
                })
            }
        });
    });
}

/* gets the information of the show that is SCHEDULED to start at the top of the next hour */
let getUpcomingShowInfo = function() {
    return new Promise((resolve, reject) => {
        let upcomingHour = moment().add(1, 'hour').format('HH');
        /* upcomingHour the next hour -> "00", "01" ... "23" */
        spinitron.getRegularShowsInfo({
            'When': 'today',
            'StartHour': '0',
        }, function(error, response) {
            if (error) {
                reject(error);
            } else if (!response.success){
                reject("Spinitron request was unsuccessful.");
            } else {
                let shows = response.results;
                /* filter today's shows, find only the one
                   scheduled to start at the upcoming hour.
                   will be empty if no shows are scheduled
                   for the upcoming hour. */
                shows = shows
                    .filter( show => moment(show['OnairTime'], 'HH:m:s')
                                        .format('HH') == upcomingHour);
                if (shows.length == 0) {
                    reject("No show scheduled for upcoming hour.")
                } else {

                    let upcomingShow = shows[0];
                    /* log show ID and show duration in hours */
                    let diff = moment(upcomingShow['OffairTime'], 'HH:m:s').diff(
                                   moment(upcomingShow['OnairTime'], 'HH:m:s'),
                                   'hours'
                               );
                    if (diff < 0) { /* show went into new day */
                        /* thank u javascript for not resolving
                           -21 % 24 as 3. */
                        diff = ((diff%24)+24)%24;
                    }
                    upcomingShow.duration = diff;
                    resolve(upcomingShow);
                }
            }
        });
    });
}

module.exports = {
    getUpcomingShowInfo : getUpcomingShowInfo,
    getCurrentPlaylist : getCurrentPlaylist
};
