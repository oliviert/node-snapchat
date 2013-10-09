var crypto = require('crypto'),
  https = require('https'),
  util = require('util'),
  qs = require('querystring'),

  microtime = require('microtime'),

  EncryptStream = require('node-cryptostream').EncryptStream;
  DecryptStream = require('node-cryptostream').DecryptStream;
 
  BLOB_ENCRYPTION_KEY = 'M02cnQ51Ji97vwT4';
  HASH_PATTERN = "0001110111101110001111010101111011010001001110011000110001000110";
  SECRET = "iEk21fuwZApXlz93750dmW22pw389dPwOk";
  STATIC_TOKEN = "m198sOkJEn37DjqZ32lpRu76xmw288xSQ9";
  API_HOST = "feelinsonice-hrd.appspot.com";
  USER_AGENT = "Snapchat/6.0.0 (iPhone; iOS 7.0.2; gzip)";
  VERSION = '6.0.0';

  MEDIA_VIDEO = 1;
  MEDIA_VIDEO_NO_AUDIO = 2;
  MEDIA_IMAGE = 0;

var createReqToken = function(a, b) {
  hashA = crypto.createHash('sha256').update(SECRET + a, 'binary').digest('hex');
  hashB = crypto.createHash('sha256').update(b + SECRET, 'binary').digest('hex');

  var token = '';
  for (var i = 0; i < HASH_PATTERN.length; i++) {
    token += HASH_PATTERN[i] == '0' ? hashA[i] : hashB[i];
  } 

  return token;
};

var getFileExtension = function(mediaType) {
  if (mediaType == MEDIA_VIDEO || mediaType == MEDIA_VIDEO_NO_AUDIO) {
    return 'mp4'
  } else if (mediaType == MEDIA_IMAGE) {
    return 'jpg'
  }

  return null;
};

var getMedia = function(data) {
  if (data.length <= 1) return false;
  if (data[0] === String.fromCharCode(0xFF) && data[1] === String.fromCharCode(0xD8)) {
    return 'jpg';
  } else if (data[0] === String.fromCharCode(0x00) && data[1] === String.fromCharCode(0x00)) {
    return 'mp4';
  }

  return null;
};

var EventEmitter = require('events').EventEmitter;

var Client = function(options) {
    EventEmitter.call(this);

    this.username = options.username;
    this.password = options.password;
    this.auth_token = null;
    this.loggedin = false;

    this.request = function(endpoint, data, options, callback) {
      if (typeof callback === 'undefined') {
        callback = options;
        options = {};
      }

      var timestamp = Date.now().toString();

      var req_token = createReqToken(
        this.auth_token ? this.auth_token : STATIC_TOKEN, timestamp);

      data['timestamp'] = timestamp;
      data['req_token'] = req_token;
      data['version'] = VERSION;
  
      var data = qs.stringify(data);

      var opts = {
        host: API_HOST,
        method: 'POST',
        path: '/bq'+endpoint,
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length
        }
      };

      var req = https.request(opts, function(res) {
        if (options.stream) {
          callback(res);
          return;
        }

        var body = '';
        res.on('data', function(chunk) {
          body += chunk;
        });

        res.on('end', function() {
          callback(body);
        });
      });

      req.write(data);
      req.end();
    };

    this.login(this.username, this.password);
};

util.inherits(Client, EventEmitter);

Client.prototype.login = function(username, password) {
  var self = this;

  self.request('/login', {
    username: username,
    password: password
  }, function(result) {
    result = JSON.parse(result);

    if (!result.logged) {
      self.emit('error', 'Login failed!\nMessage: '+result.message);
      return;
    }

    self.auth_token = result.auth_token;
    self.username = result.username;
    self.loggedin = true;

    self.emit('loggedin');
  });
};

Client.prototype.logout = function(callback) {
  var self = this;

  if (!self.loggedin) return;

  var mtime = microtime.now() / 1000;

  self.request('/logout', {
    username: self.username,
    timestamp: mtime
  }, function(result) {
    if (result.length !== 0) {
      self.emit('error', 'Logout failed!\nResponse: ' + result);
      callback(false);
      return;
    }

    if (typeof callback !== 'undefined')
      callback(true);

    delete self.auth_token;

    self.emit('loggedout');
  });
};

Client.prototype.getUpdates = function(timestamp, callback) {
  var self = this;

  if (typeof callback === 'undefined') {
    callback = timestamp;
    timestamp = 0;
  }

  self.request('/updates', {
    username: self.username,
    update_timestamp: timestamp
  }, function(result) {
    result = JSON.parse(result);

    if (result.hasOwnProperty('auth_token'))
      self.auth_token = result.auth_token;

    callback(result);
  });
};

Client.prototype.getSnaps = function(timestamp, callback) {
  var self = this;

  if (typeof callback === 'undefined') {
    callback = timestamp;
  }

  self.getUpdates(function(result) {
    if (!result.hasOwnProperty('snaps')) {
      callback([]);
      return;
    }

    var snaps = [];
    for (var k in result.snaps) {
      if (result.snaps[k].hasOwnProperty('c_id')) continue;
      snaps.push(result.snaps[k]);  
    }
    callback(snaps);
  });
};

Client.prototype.getBlob = function(id, fstream, callback) {
  var self = this;

  self.request('/blob', {
    username: self.username,
    id: id
  }, { stream: true }, function(res) {
    if (fstream.setHeader) {
      fstream.setHeader('Content-type', res.headers['content-type']);
    }

    var decryptStream = new DecryptStream({ algorithm: 'aes-128-ecb', key: BLOB_ENCRYPTION_KEY });
    res.pipe(decryptStream);
    decryptStream.pipe(fstream);

    decryptStream.on('end', function() {
      if (callback) callback(); 
    })
  });
}

Client.prototype.sendEvents = function(events, data, callback) {
  var self = this;

  if (typeof data === 'undefined') data = {};

  self.request('/update_snaps', {
    username: self.username,
    events: JSON.stringify(events),
    json: JSON.stringify(data)
  }, function(result) {
    if (typeof callback === 'undefined') return;

    if (!result.length) {
      callback();
    } else {
      callback(result);
    }
  });
};

Client.prototype.markViewed = function(id, time, callback) {
  var self = this;

  if (typeof time === 'undefined') time = 1; 

  var mtime = microtime.nowDouble();

  data = {};
  data[id] = { t: mtime, sv: time};

  events = [
    { eventName: 'SNAP_VIEW',
      params: { id: id },
      ts: Math.floor(mtime) - time
    },
    { eventName: 'SNAP_EXPIRED',
      params: { id: id },
      ts: Math.floor(mtime)
    }
  ];

  self.sendEvents(events, data, function(err) {
    if (typeof callback === 'undefined') return;

    if (err) {
      callback(err);
    } else {
      callback();
    }
  });
};

Client.prototype.block = function(username, callback) {
  var self = this;
  if (!self.auth_token || !self.loggedin) {
    callback(new Error('Client is not authenticated.'));
    return;
  }

  var mtime = microtime.now() / 1000;

  self.request('/friend', {
    action: 'block', 
    friend: username,
    timestamp: mtime,
    username: self.username
  }, function(result) {
    result = JSON.parse(result);
    if (result.param || result.logged) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  });
}

Client.prototype.unblock = function(username, callback) {
  var self = this;
  if (!self.auth_token || !self.loggedin) {
    callback(new Error('Client is not authenticated.'));
    return;
  }

  var mtime = microtime.now() / 1000;

  self.request('/friend', {
    action: 'unblock', 
    friend: username,
    timestamp: mtime,
    username: self.username
  }, function(result) {
    result = JSON.parse(result);
    if (result.param || result.logged) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  });
};

module.exports.Client = Client;
module.exports.getFileExtension = getFileExtension;