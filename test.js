var fs = require('fs-extra');

require('./index').testrun({
    dbhost: 'localhost',
    dbport: 3306,
    dbname: 'phpbb3',
    dbuser: 'user',
    dbpass: 'password',

    tablePrefix: 'phpbb_',
	
	custom: {
        avatarFolder: 'http://localhost/forum/images/avatars/upload/',
        avatarHash: 'fac102cfc934b0dc8ef51ec172279d8c',
        adminGroup: '5',
        modGroup: '4',
        attachmentsFolder: 'http://localhost/forum/files/'    
    }
}, function(err, results) {
    fs.writeFileSync('./tmp.json', JSON.stringify(results, undefined, 2));
});