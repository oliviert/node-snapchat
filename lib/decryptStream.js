var crypto = require('crypto'),
  util = require('util'),
  Transform = require('stream').Transform;
 
function DecryptStream(options) {
  if (!(this instanceof DecryptStream))
    return new DecryptStream(options);

  Transform.call(this, options);

  this.key = options.key; 

  this._decipher = crypto.createDecipheriv('aes-128-ecb', this.key, '');    
  this._decipher.setAutoPadding(true);
};

util.inherits(DecryptStream, Transform);

DecryptStream.prototype._transform = function(chunk, encoding, callback) {
  this.push(this._decipher.update(chunk));
  callback();
};

DecryptStream.prototype._flush = function(callback) {
  this.push(this._decipher.final());
  callback();
}

module.exports = DecryptStream;