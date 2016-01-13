nodebb-plugin-import-phpbb
==========================

A phpBB3 to NodeBB exporter based on [nodebb-plugin-import-phpbb](nodebb-plugin-import-phpbb) by @psychobunny. Also uses work by @belstgut.

Use this to import data into NodeBB using [nodebb-plugin-import](https://github.com/akhoury/nodebb-plugin-import).

### Supported [nodebb-plugin-import](https://github.com/akhoury/nodebb-plugin-import/blob/master/write-my-own-exporter.md) features:
- Users: _uid, _email, _username, _joindate, _signature, _pictureBlob, _pictureFilename, _groups, _website, _banned, _location, _birthday, _lastposttime, _level, _lastonline

- Categories: _cid, _name, _description

- Topics: _tid, _uid, _cid, _ip, _title, _content, _timestamp, _viewcount, _locked, attachmentsBlobs, _deleted (used for unapproved topics), _pinned, _edited

- Posts: _pid, _tid, _content, _uid, _timestamp, _ip, _edited, _attachmentsBlobs

- Messages: _mid, _fromuid, _touid, _content, _timestamp

- Groups: _gid, _name, _ownerUid, _description


### How to use:

For information on how to use the importer, please visit its github page [here](https://github.com/akhoury/nodebb-plugin-import). For information on how to use this specific plugin, continue reading.

Under select exporter, use this git's url (git://github.com/cp-nilly/nodebb-plugin-import-phpbb#master) into text box for the module name.

Under _Exporter specific configs_, the following extended fields exist:
```
custom: {
        avatarFolder: "http://localhost/forum/images/avatars/upload/",
        avatarHash: "fac102cfc934b0dc8ef51ec172279d8c",
        adminGroup: "5",
        modGroup: "4",
        attachmentsFolder: "http://localhost/forum/files/"    
    }
```

To use them with the exporter, just form a valid json with any or all the fields above.

Example: 
```
{ avatarFolder: "http://localhost/forum/images/avatars/upload/", avatarHash: "fac102cfc934b0dc8ef51ec172279d8c", adminGroup: "5", modGroup: "4", attachmentsFolder: "http://localhost/forum/files/" }
```

Field Info:
- avatarFolder: Url to the directory where avatar uploads are stored.
- avatarHash: Hash that precedes all uploaded avatar images. Just look where the avatars are stored and you'll see every file name proceeded with the hash.
- adminGroup: Group number of the admin group on your forums. I assume the default is 5 for every board. Unless you customized groups heavily on your board, I'd try 5. Otherwise, access the db and look for it.
- modGroup: Group number of your global mods. Again, assuming the default is 4 for every board. Try that or look through your db to find out.
- attachmentsFolder: Url where attachments to your board are stored.

Notes:
- If any of the custom fields are left out, the specific feature will be disabled. For example if avatarFolder is not defined, the "importer" will not export avatars. Same goes for adminGroup, modGroup, and attachmentsFolder. 
- The use of adminGroup or modGroup causes their corresponding group not to be exported.
- Everyone using this exporter should be using adminGroup since it solves the problem of duplicate admin groups getting added to your nodebb forum (can cause problems).
- It is probably best not to use modGroup field since it is probably easier to export the global mod group to the importer. Managing a mod group is easier than managing several user mods.
- This exporter's avatar and attachment exporting methods might not work for your specific needs. In order for the importer to take files from an existing forum location and store it on the nodebb server, I made use of the blob features of the importer. This means that the actual file data is loaded into memory at once. If you got a lot of content it is possible to exhaust your system's memory resources. For my specific needs, it wasn't a problem because I had less than 100mb in attachments/avatars.

### Handy Post Import Info:
If you want to make use of the importer's bbcode to markdown feature, these regexs should come in handy. Since the importer is under active development, these regex's may become obsolete/not work over time. I am providing them mostly as a reference to aid you guys in getting the conversion right.

Pre-parse
```
content = content.replace(/<!--.*?-->(.*?)<!--.*?-->/g, '$1');
content = content.replace(/<a class="postlink(-local)?" href="(.*?)">(.*?)<\/a>/g, '$2');
content = content.replace(/<img src="\{SMILIES_PATH\}\/.+?" alt="(.+?)" title=.+?\/>/g, ' $1 ');
content = content.replace(/\[(.*?):[\w:]+\]/g, '[$1]');
content = content.replace(/\[((\/)?code)\]/g, '[$1_newLineHack]');
```

Post-parse
```
content = content.replace(/\[attachment=\d+\](.*?)\[\/attachment\]/g, '');
content = content.replace(/\@"([^\s]+?)?":/g, '@$1:');
content = content.replace(/((\\r)?\\n)?\[((\/)?code_newLineHack)\]((\\r)?\\n)?/g, '\n```\n');
```

I've found that under nodebb v0.9.2 and nodebb-plugin-import v0.3.31, post import tools doesn't work with messages. So try unchecking that box if your having problems.