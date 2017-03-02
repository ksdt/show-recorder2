# This is the new show recorder.

Some features include
* Intelligent recording, will record 1 or 2 hours depending on show length.
* Will name mp3s after the spinitron playlist ID associated with the show, if it is able to be found
* Can optionally upload shows to b2 backblaze cloud storage.

To run, leave it in a cron job set to run every hour ideally anytime between :50 and :58, and if there's a show scheduled to start at the top of the next hour, it will record that show. Otherwise it will do nothing.

wip
