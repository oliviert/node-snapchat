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

DecryptStream.prototype._transform = function(chunk, encoding, done) {
  this.push(this._decipher.update(chunk));
  done();
};

module.exports = DecryptStream;