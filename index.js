
var async = require('async');
var mysql = require('mysql');
var _ = require('underscore');
var noop = function(){};
var logPrefix = '[nodebb-plugin-import-phpbb]';
var request = require('request');

(function(Exporter) {

    Exporter.setup = function(config, callback) {
        Exporter.log('setup');

        // mysql db only config
        // extract them from the configs passed by the nodebb-plugin-import adapter
        var _config = {
            host: config.dbhost || config.host || 'localhost',
            user: config.dbuser || config.user || 'root',
            password: config.dbpass || config.pass || config.password || '',
            port: config.dbport || config.port || 3306,
            database: config.dbname || config.name || config.database || 'phpbb',
            
            // example: http://localhost/forum/images/avatar/
            avatarFolder: config.custom.avatarFolder || '', 
            // got to look at upload folder to find this out
            avatarHash: config.custom.avatarHash || 'fac102cfc934b0dc8ef51ec172279d8c', 
            // admin group number of your phpbb board (default admin group for me was 5)
            adminGroup: config.custom.adminGroup || '',
            // moderator group number of your phpbb board. (default global moderator group for me was 4)
            modGroup: config.custom.modGroup || '',
            // example: http://localhost/forum/files/
            attachmentsFolder: config.custom.attachmentsFolder || '' 
        };

        Exporter.config(_config);
        Exporter.config('prefix', config.prefix || config.tablePrefix || '' /* phpbb_ ? */ );

        Exporter.connection = mysql.createConnection(_config);
        Exporter.connection.connect();

        callback(null, Exporter.config());
    };

    Exporter.getUsers = function(callback) {
        return Exporter.getPaginatedUsers(0, -1, callback);
    };
    Exporter.getPaginatedUsers = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;
        
        var adminGroup = Exporter.config('adminGroup');
        var modGroup = Exporter.config('modGroup');
        var userGroups;
        var bannedUsers;
        var users;
        
        var actions = [
            function(cb) {
                Exporter.getBannedUsers(function(err, res) {
                    if (err) {
                        Exporter.error(err);
                        return callback(err);
                    }
    
                    bannedUsers = res;
                    cb();
                });
            },
            function(cb) {
                Exporter.getUserGroups(function(err, res) {
                    if (err) {
                        Exporter.error(err);
                        return callback(err);
                    }

                    userGroups = res;
                    cb();
                });
            },
            function(cb) {
                Exporter.getUserList(start, limit, function(err, res) {
                    if (err) {
                        Exporter.error(err);
                        return callback(err);
                    }
                    
                    users = res;
                    cb();
                });
            }
        ];
        
        async.parallel(actions, function(err) {
            if (err) {
                Exporter.error(err);
                return callback(err);
            }
            
            //normalize dependent variables here
            var map = {};
            users.forEach(function(user) {
                user._groups = userGroups[user._uid] || [];
                
                bannedUsers.some(function(bannedUser) {
                    if (bannedUser == user._uid) {
                        user._banned = 1;
                        return true;
                    }
                    return false;
                });
                
                user._groups.some(function(group) {
                    if (adminGroup != '' && parseInt(adminGroup, 10) == group) {
                        user._level = 'administrator';
                        return true;
                    }
                    if (modGroup != '' && parseInt(modGroup, 10) == group) {
                        user._level = 'moderator';
                    }
                });

                map[user._uid] = user;
            });

            callback(null, map);
        });
    };
    Exporter.getUserList = function(start, limit, callback) {
        var err;
        var prefix = Exporter.config('prefix');
        var avatarFolder = Exporter.config('avatarFolder');
        var avatarHash = Exporter.config('avatarHash');
        var startms = +new Date();
        var query = 'SELECT ' 
            + prefix + 'users.user_id as _uid, ' 
            + prefix + 'users.user_email as _email, '
            + prefix + 'users.username as _username, ' 
            + prefix + 'users.user_regdate as _joindate, ' 
            + prefix + 'users.username_clean as _alternativeUsername, '
            + prefix + 'users.user_sig as _signature, ' 
            + prefix + 'users.user_avatar as _pictureFilename, '
            // _pictureBlob (handled below)
            // _path
            + prefix + 'users.user_website as _website, '
            // _fullname
            // _readCids
            // _readTids
            + prefix + 'users.user_from as _location, '
            // _reputation
            // _profileviews
            + prefix + 'users.user_birthday as _birthday, '
            // _showemail
            + prefix + 'users.user_lastpost_time as _lastposttime, '
            + prefix + 'users.user_lastvisit as _lastonline '
            + 'FROM ' + prefix + 'users ' 
            + 'WHERE ' + prefix + 'users.user_type <> 2 AND ' + prefix + 'users.user_type <> 1 ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');
    
        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }
        
        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize independent variables here
                rows.forEach(function(row) {
                    // nbb forces signatures to be less than 255 chars
                    row._signature = Exporter.truncateStr(row._signature || '', 255);
                    
                    // from unix timestamp (s) to JS timestamp (ms)
                    row._joindate = ((row._joindate || 0) * 1000) || startms;
                    row._lastposttime = ((row._lastposttime || 0) * 1000) || 0;
                    row._lastonline = ((row._lastonline || 0) * 1000) || undefined;
                    
                    // lower case the email for consistency
                    row._email = (row._email || '').toLowerCase();
                    
                    // I don't know about you about I noticed a lot my
                    // users have incomplete urls, urls like: http://
                    row._website = Exporter.validateUrl(row._website); 
                    
                    row._location = (row._location || '').trim();
                    row._birthday = Exporter.formatPhpbbDate(row._birthday); 
                    
                    // handle avatar
                    if (avatarFolder != '') {
                        row._pictureFilename = (row._pictureFilename || '')
                            .replace(/^([^_]+)_\d+\.(.*)$/, avatarHash + "_$1.$2");
                    } else {
                        row._pictureFilename = '';
                    }
                });
                
                var getAvatarBlobs = rows.map(function(user) {
                    return function(cb) {
                        if (user._pictureFilename == '') {
                            cb();
                            return;
                        }
                        
                        var uri = avatarFolder + user._pictureFilename;
                        request(uri, { encoding: null }, function(error, response, body) {
                            if (err || response.statusCode != 200) {
                                user._pictureFilename = '';
                                cb();
                                return;
                            }
                            
                            user._pictureBlob = body;
                            cb();
                        });
                    };
                });

                async.parallel(getAvatarBlobs, function(err) {
                    callback(err, rows);
                });
            });
    };
    Exporter.getBannedUsers = function(callback) {
        var err;
        var prefix = Exporter.config('prefix');
        var query = 'SELECT ' 
            + prefix + 'banlist.ban_userid as _uid ' 
            + 'FROM ' + prefix + 'banlist ' 
            + 'WHERE ' + prefix + 'banlist.ban_userid <> 0';

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var bannedUids = rows.map(function(row) {
                    return row._uid;
                });

                callback(null, bannedUids);
            });
    };
    Exporter.getUserGroups = function(callback) {
        var err;
        var prefix = Exporter.config('prefix');
        var query = 'SELECT '
            + prefix + 'user_group.group_id as _gid, '
            + prefix + 'user_group.user_id as _uid, '
            + prefix + 'user_group.user_pending as _pending ' 
            + 'FROM ' + prefix + 'user_group';

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var groups = {};
                rows.forEach(function(row) {
                    // setup array if first time user is encountered
                    if (groups[row._uid] == undefined) {
                        groups[row._uid] = [];
                    }
                    
                    if (row._pending != 1) {
                        groups[row._uid].push(row._gid);
                    }
                });

                callback(null, groups);
            });
    };
    
    Exporter.getMessages = function(callback) {
        return Exporter.getPaginatedMessages(0, -1, callback);
    };
    Exporter.getPaginatedMessages = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT ' 
            + prefix + 'privmsgs.msg_id as _mid, ' 
            + prefix + 'privmsgs.author_id as _fromuid, ' 
            + prefix + 'privmsgs.to_address as _touid, ' 
            + prefix + 'privmsgs.message_text as _content, ' 
            + prefix + 'privmsgs.message_time as _timestamp '
            +'FROM ' + prefix + 'privmsgs ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var map = {};
                rows.forEach(function(row) {
                    row._touid = row._touid.substr(2);
                    row._content = row._content || '';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;

                    map[row._mid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getGroups = function(callback) {
        return Exporter.getPaginatedGroups(0, -1, callback);
    };
    Exporter.getPaginatedGroups = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var adminGroup = Exporter.config('adminGroup');
        var modGroup = Exporter.config('modGroup');
        var query = 'SELECT ' 
            + prefix + 'groups.group_id as _gid, ' 
            + prefix + 'groups.group_name as _name, '
            // _ownerUid (handled below)
            + prefix + 'groups.group_desc as _description '
            // _timestamp
            +'FROM ' + prefix + 'groups ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                // get group leader
                var map = {};
                var gids = rows.map(function(row) {
                    return row._gid;
                });
                Exporter.getGroupLeaders(gids, function(err, gLeaders) {
                    if (err) {
                        Exporter.error(err);
                        return callback(err);
                    }

                    rows.forEach(function(row) {
                        // don't add admin and moderator groups from phpbb
                        if (adminGroup != '' && parseInt(adminGroup, 10) == row._gid) {
                            return;
                        }
                        if (modGroup != '' && parseInt(modGroup, 10) == row._gid) {
                            return;
                        }
                        
                        row._ownerUid = gLeaders[row._gid];
                        row._description = row._description || '';
                        
                        map[row._gid] = row;
                    });
                    callback(null, map);
                });
            });
    };
    Exporter.getGroupLeaders = function(gids, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var query = 'SELECT '
            + prefix + 'user_group.group_id as _gid, ' 
            + prefix + 'user_group.user_id as _uid, ' 
            + prefix + 'user_group.group_leader as _leader, ' 
            + prefix + 'user_group.user_pending as _pending ' 
            + 'FROM ' + prefix + 'user_group ';

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, userGroup) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var leaders = {};
                gids.forEach(function(gid) {
                    userGroup.some(function(ug) {
                        if (gid == ug._gid && ug._leader == 1) {
                            leaders[gid] = ug._uid;
                            return true;
                        }
                        return false;
                    });

                    if (leaders[gid] == undefined) {
                        userGroup.some(function(ug) {
                            if (gid == ug._gid && ug._pending != 1) {
                                leaders[gid] = ug._uid;
                                return true;
                            }
                            return false;
                        });
                    }
                });

                callback(null, leaders);
            });
    };

    Exporter.getCategories = function(callback) {
        return Exporter.getPaginatedCategories(0, -1, callback);
    };
    Exporter.getPaginatedCategories = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT ' 
            + prefix + 'forums.forum_id as _cid, ' 
            + prefix + 'forums.forum_name as _name, ' 
            + prefix + 'forums.forum_desc as _description '
            + 'FROM ' + prefix + 'forums ' 
            + 'WHERE ' + prefix + 'forums.forum_type <> 0 ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._name = row._name || 'Untitled Category';
                    row._description = row._description || 'No decscription available';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;

                    map[row._cid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getTopics = function(callback) {
        return Exporter.getPaginatedTopics(0, -1, callback);
    };
    Exporter.getPaginatedTopics = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT ' 
            + prefix + 'topics.topic_id as _tid, ' 
            + prefix + 'posts.poster_id as _uid, '
            + prefix + 'topics.forum_id as _cid, '
            + prefix + 'posts.poster_ip as _ip, '
            + prefix + 'topics.topic_title as _title, ' 
            + prefix + 'posts.post_text as _content, '
            // _thumb
            + prefix + 'topics.topic_time as _timestamp, '
            + prefix + 'topics.topic_views as _viewcount, ' 
            // _locked (handled below)
            // _attachmentsBlobs (handled below)
            // _deleted (used with unapproved topics)
            // _pinned (handled below)
            + prefix + 'posts.post_edit_time as _edited, '
            // below are aux vars used for setting other vars
            + prefix + 'topics.topic_approved as _approved, ' 
            + prefix + 'topics.topic_status as _status, '
            + prefix + 'topics.topic_type as _type, '
            + prefix + 'topics.topic_first_post_id as _pid ' // just a ref for query
            + 'FROM ' + prefix + 'topics, ' + prefix + 'posts ' 
            + 'WHERE ' + prefix + 'topics.topic_first_post_id=' + prefix + 'posts.post_id ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var map = {};
                var topicWork = rows.map(function(topic) {
                    return function(cb) {
                        topic._title = topic._title ? topic._title[0].toUpperCase() + topic._title.substr(1) : 'Untitled';
                        topic._timestamp = ((topic._timestamp || 0) * 1000) || startms;
                        topic._edited = ((topic._edited || 0) * 1000) || 0;
                        topic._locked = (topic._status == 1) ? 1 : 0;
                        topic._deleted = (topic._approved == 0) ? 1 : 0;
                        topic._pinned = (topic._type > 0) ? 1 : 0;
                        
                        Exporter.getPostAttachments(topic, function(err, topic_wBlob) {
                            if (err) {
                                Exporter.error(err);
                                return callback(err);
                            }

                            map[topic_wBlob._tid] = topic_wBlob;
                            cb();
                        });
                    };
                });

                async.parallel(topicWork, function(err) {
                    callback(err, map);
                });
            });
    };

    Exporter.getPosts = function(callback) {
        return Exporter.getPaginatedPosts(0, -1, callback);
    };
    Exporter.getPaginatedPosts = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT ' 
            + prefix + 'posts.post_id as _pid, '
            + prefix + 'posts.topic_id as _tid, ' 
            + prefix + 'posts.post_text as _content, ' 
            + prefix + 'posts.poster_id as _uid, '
            + prefix + 'posts.post_time as _timestamp, ' 
            + prefix + 'posts.poster_ip as _ip, '
            + prefix + 'posts.post_edit_time as _edited, '
            // _reputation
            // _attachmentsBlobs (handled below)
            // below are aux vars used for setting other vars
            + prefix + 'posts.post_approved as _approved '
            + 'FROM ' + prefix + 'posts '
            + 'WHERE ' + prefix + 'posts.topic_id > 0 AND ' + prefix + 'posts.post_id NOT IN (SELECT ' + prefix + 'topics.topic_first_post_id ' + 'FROM ' + prefix + 'topics) ' 
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var map = {};
                var postWork = rows.map(function(post) {
                    return function(cb) {
                        // don't add unapproved posts
                        if (post._approved == 0) {
                            cb();
                            return;
                        }
                        
                        post._content = post._content || '';
                        post._timestamp = ((post._timestamp || 0) * 1000) || startms;
                        post._edited = ((post._edited || 0) * 1000) || 0;

                        Exporter.getPostAttachments(post, function(err, post_wBlob) {
                            if (err) {
                                Exporter.error(err);
                                return callback(err);
                            }

                            map[post_wBlob._pid] = post_wBlob;
                            cb();
                        });
                    };
                });

                async.parallel(postWork, function(err) {
                    callback(err, map);
                });
            });
    };

    Exporter.getPostAttachments = function(post, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var attachmentsFolder = Exporter.config('attachmentsFolder');
        if (attachmentsFolder == '') {
            callback(null, post);
            return;
        }
        
        var err;
        var prefix = Exporter.config('prefix');
        var query = 'SELECT ' 
            + prefix + 'attachments.real_filename as _name, ' 
            + prefix + 'attachments.physical_filename as _loc, ' 
            + prefix + 'attachments.is_orphan as _orphan ' 
            + 'FROM ' + prefix + 'attachments ' 
            + 'WHERE ' + prefix + 'attachments.post_msg_id = ' + post._pid;

        if (!Exporter.connection) {
            err = { error: 'MySQL connection is not setup. Run setup(config) first' };
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, attachments) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                var getBlobs = attachments.map(function(attachment) {
                    return function(cb) {
                        if (attachment._orphan) {
                            cb();
                            return;
                        }

                        var uri = attachmentsFolder + attachment._loc;
                        request(uri, { encoding: null }, function(error, response, body) {
                            if (err || response.statusCode != 200) {
                                Exporter.error(err);
                                return callback(err);
                            }

                            attachment._blob = body;
                            cb();
                        });
                    };
                });

                async.parallel(getBlobs, function(err) {
                    var ab = attachments.map(function(attachment) {
                        return {
                            "blob": attachment._blob,
                            "filename": attachment._name
                        };
                    });
                    post._attachmentsBlobs = ab;
                    callback(err, post);
                });
            });
    };

    Exporter.teardown = function(callback) {
        Exporter.log('teardown');
        Exporter.connection.end();

        Exporter.log('Done');
        callback();
    };

    Exporter.testrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getUsers(next);
            },
            function(next) {
                Exporter.getCategories(next);
            },
            function(next) {
                Exporter.getTopics(next);
            },
            function(next) {
                Exporter.getPosts(next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.paginatedTestrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getPaginatedUsers(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedCategories(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedTopics(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedPosts(1001, 2000, next);
            },
            function(next) {
                Exporter.getPaginatedGroups(0, 1000, next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.warn = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.warn.apply(console, args);
    };

    Exporter.log = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.log.apply(console, args);
    };

    Exporter.error = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.error.apply(console, args);
    };

    Exporter.config = function(config, val) {
        if (config != null) {
            if (typeof config === 'object') {
                Exporter._config = config;
            }
            else if (typeof config === 'string') {
                if (val != null) {
                    Exporter._config = Exporter._config || {};
                    Exporter._config[config] = val;
                }
                return Exporter._config[config];
            }
        }
        return Exporter._config;
    };

    // from Angular https://github.com/angular/angular.js/blob/master/src/ng/directive/input.js#L11
    Exporter.validateUrl = function(url) {
        var pattern = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
        return url && url.length < 2083 && url.match(pattern) ? url : '';
    };

    Exporter.truncateStr = function(str, len) {
        if (typeof str != 'string') return str;
        len = _.isNumber(len) && len > 3 ? len : 20;
        return str.length <= len ? str : str.substr(0, len - 3) + '...';
    };

    Exporter.whichIsFalsy = function(arr) {
        for (var i = 0; i < arr.length; i++) {
            if (!arr[i])
                return i;
        }
        return null;
    };
    
    Exporter.formatPhpbbDate = function(phpbbDate) {
        var nums = (phpbbDate || '').split('-')
            .map(function(num) { return num.trim(); });
            
        if (nums.length != 3) {
            return '';
        }
        
        var i = 0;
        while (i < 3) {
            if (nums[i] == "0") {
                return '';
            }
            i++;
        }
        
        var temp = nums[1];
        nums[1] = nums[0];
        nums[0] = temp;
        
        nums[0] = Exporter.pad(nums[0], 2);
        nums[1] = Exporter.pad(nums[1], 2);
        nums[2] = Exporter.pad(nums[2], 4);
        return nums.join('/');
    };
    
    Exporter.pad = function(n, width, z) {
        z = z || '0';
        n = n + '';
        return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
    };
})(module.exports);