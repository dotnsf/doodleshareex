//. db_cloudant_old.js
var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    crypto = require( 'crypto' ),
    fs = require( 'fs' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    uuidv1 = require( 'uuid/v1' ),
    api = express();

var settings = require( '../settings' );

var settings_db_username = 'DB_USERNAME' in process.env ? process.env.DB_USERNAME : settings.db_username; 
var settings_db_password = 'DB_PASSWORD' in process.env ? process.env.DB_PASSWORD : settings.db_password; 
var settings_db_url = 'DB_URL' in process.env ? process.env.DB_URL : settings.db_url; 
var settings_db_name = 'DB_NAME' in process.env ? process.env.DB_NAME : settings.db_name; 

var db = null;
var cloudant = null;
if( settings_db_username && settings_db_password ){
  var params = { account: settings_db_username, password: settings_db_password };
  if( settings_db_url ){
    params.url = settings_db_url;
  }
  cloudant = cloudantlib( params );
  if( cloudant ){
    cloudant.db.get( settings_db_name, function( err, body ){
      if( err ){
        if( err.statusCode == 404 ){
          cloudant.db.create( settings_db_name, function( err, body ){
            if( err ){
              db = null;
            }else{
              db = cloudant.db.use( settings_db_name );
            }
          });
        }else{
          db = cloudant.db.use( settings_db_name );
        }
      }else{
        db = cloudant.db.use( settings_db_name );
      }
    });
  }
}


api.use( multer( { dest: '../tmp/' } ).single( 'image' ) );
api.use( bodyParser.urlencoded( { extended: true } ) );
api.use( bodyParser.json() );
api.use( express.Router() );

api.post( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var imgpath = req.file.path;
    var imgtype = req.file.mimetype;
    //var imgsize = req.file.size;
    var ext = imgtype.split( "/" )[1];
    var imgfilename = req.file.filename;
    var filename = req.file.originalname;

    var image_id = uuidv1();
    var img = fs.readFileSync( imgpath );
    var img64 = new Buffer( img ).toString( 'base64' );

    var params = {
      _id: image_id,
      filename: filename,
      type: 'image',
      timestamp: ( new Date() ).getTime(),
      name: req.body.name,
      comment: req.body.comment,
      room: req.body.room,
      uuid: req.body.uuid,
      _attachments: {
        image: {
          content_type: imgtype,
          data: img64
        }
      }
    };
    db.insert( params, image_id, function( err, body, header ){
      if( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var p = JSON.stringify( { status: true, id: image_id, body: body }, null, 2 );
        res.write( p );
        res.end();
      }
      fs.unlink( imgpath, function( err ){} );
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.get( '/image', function( req, res ){
  if( db ){
    var image_id = req.query.id;
    db.attachment.get( image_id, 'image', function( err1, body1 ){
      res.contentType( 'image/png' );
      res.end( body1, 'binary' );
    });
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.delete( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.query.id;

    //. Cloudant から削除
    db.get( id, null, function( err1, body1, header1 ){
      if( err1 ){
        err1.image_id = "error-1";
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err1 } ) );
        res.end();
      }

      var rev = body1._rev;
      db.destroy( id, rev, function( err2, body2, header2 ){
        if( err2 ){
          err2.image_id = "error-2";
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err2 } ) );
          res.end();
        }

        body2.image_id = id;
        res.write( JSON.stringify( { status: true, body: body2 } ) );
        res.end();
      });
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});


//. #11
api.readImages = async function( limit, offset, room ){
  return new Promise( async ( resolve, reject ) => {
    if( db ){
      var selector = { type: { "$eq": "image" } };
      if( room ){
        selector = { room: { "$eq": room } };
      }
      db.find( { selector: selector, fields: [ "_id", "_rev", "name", "type", "comment", "timestamp", "room", "uuid" ] }, function( err, result ){
        if( err ){
          resolve( { status: false, error: err } );
        }else{
          var total = result.docs.length;
          var images = [];
          result.docs.forEach( function( doc ){
            if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' ){
              images.push( doc );
            }
          });

          images.sort( sortByTimestamp );

          if( offset || limit ){
            if( offset + limit > total ){
              images = images.slice( offset );
            }else{
              images = images.slice( offset, offset + limit );
            }
          }

          resolve( { status: true, limit: limit, offset: offset, images: images } );
        }
      });
    }else{
      resolve( { status: false, error: 'db is failed to initialize.' } );
    }
  });
}

api.get( '/images', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var room = req.query.room ? req.query.room : ''; //'default';

  var r = await api.readImages( limit, offset, room );
  if( !r.status ){
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: r.error } ) );
    res.end();
  }else{
    res.write( JSON.stringify( { status: true, limit: limit, offset: offset, images: r.images } ) );
    res.end();
  }
});

//. #11
api.readRoom = async function( id, basic_id, basic_password ){
  return new Promise( async ( resolve, reject ) => {
    if( db ){
      db.get( id, { include_docs: true }, function( err1, body1, header1 ){
        if( err1 ){
          //console.log( err1 );
          //resolve( { status: false, error: err1 } );
          resolve( { status: true, room: null, error: err1 } );
        }else{
          var room = body1;
    
          if( room ){
            if( !room.basic_id && !room.basic_password ){
              resolve( { status: true, room: room } );
            }else{
              if( room.basic_id == basic_id && room.basic_password == basic_password ){
                resolve( { status: true, room: room } );
              }else{
                resolve( { status: false, error: 'wrong credentials' } );
              }
            }
          }else{
            //. 指定の room が見つからなかった場合、この扱いをどうする？
  
            //.   - [ ] 指定の room を自動作成した上でアクセスを認める？
            //.         その場合のパスワードなどはどうする？？
            //room = ...
            //resolve( { status: true, room: room } );
            //.   - [ ] room は作成しないが、アクセス（利用）を認める？
            resolve( { status: true, room: null } );
            //.   - [ ] room を作る前のアクセスは認めない？
            //resolve( { status: false, error: "not found." } );
          }
        }
      });
    }else{
      resolve( { status: false, error: "db is not initialized." } );
    }
  });
}

api.post( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    var r = await api.readRoom( id );
    if( !r.status || r.room == null ){
      //. 指定の room が存在していないことを確認できたので、作成
      var uuid = req.body.uuid;
      var basic_id = req.body.basic_id;
      var basic_password = req.body.basic_password;
      var enc_basic_password = getHash( basic_password );
      var ts = ( new Date() ).getTime();

      var params = {
        _id: id,
        type: 'room',
        uuid: uuid,
        basic_id: basic_id,
        basic_password: enc_basic_password,
        created: ts,
        updated: ts
      };
      db.insert( params, id, function( err, body, header ){
        if( err ){
          console.log( err );
          var p = JSON.stringify( { status: false, error: err }, null, 2 );
          res.status( 400 );
          res.write( p );
          res.end();
        }else{
          var p = JSON.stringify( { status: true, id: id, body: result }, null, 2 );
          res.write( p );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'room existed.' } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.get( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password );
    if( r.status && r.room ){
      res.write( JSON.stringify( { status: true, room: r.room } ) );
      res.end();
    }else{
      if( r.error ){
        if( r.error == 'wrong credentials' ){
          res.write( JSON.stringify( { status: true, room: null, error: r.error } ) );
          res.end();
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: r.error } ) );
          res.end();
        }
      }else{
        //. まだ存在していない
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "not existed." } ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.put( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password  );
    if( r.status && r.room ){
      var new_basic_id = req.body.new_basic_id;
      var new_basic_password = req.body.new_basic_password;
      var enc_new_basic_password = getHash( new_basic_password );
      var ts = ( new Date() ).getTime();

      r.room.basic_id = new_basic_id;
      r.room.basic_password = enc_new_basic_password;
      r.room.updated = ts;

      db.insert( r.room, function( err, body, header ){
        if( err ){
          console.log( err );
          var p = JSON.stringify( { status: false, error: err }, null, 2 );
          res.status( 400 );
          res.write( p );
          res.end();
        }else{
          var p = JSON.stringify( { status: true, id: id, body: body }, null, 2 );
          res.write( p );
          res.end();
        }
      });
    }else{
      if( r.error ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: r.error } ) );
        res.end();
      }else{
        //. まだ存在していない
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "not existed." } ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.delete( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password  );
    if( r.status && r.room ){
      var rev = r.room._rev;
      db.destroy( id, rev, function( err, body, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true } ) );
          res.end();
        }
      });
    }else{
      if( r.error ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: r.error } ) );
        res.end();
      }else{
        //. まだ存在していない
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "not existed." } ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

api.get( '/rooms', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var uuid = req.query.uuid ? req.query.uuid : '';

  if( db && uuid ){
    db.find( { selector: { uuid: { "$eq": uuid } }, fields: [ "_id", "_rev", "name", "type", "comment", "timestamp", "room", "uuid" ] }, function( err, result ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var total = result.docs.length;
        var rooms = [];
        result.docs.forEach( function( doc ){
          if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'room' ){
            rooms.push( doc );
          }
        });

        rooms.sort( sortByTimestamp );

        if( offset || limit ){
          if( offset + limit > total ){
            rooms = rooms.slice( offset );
          }else{
            rooms = rooms.slice( offset, offset + limit );
          }
        }

        var result = { status: true, uuid: uuid, total: total, limit: limit, offset: offset, rooms: rooms };
        res.write( JSON.stringify( result, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

function getHash( s ){
  if( s ){
    return crypto.createHash( 'sha1' ).update( s ).digest( 'hex' );
  }else{
    return '';
  }
}


function timestamp2datetime( ts ){
  if( ts ){
    var dt = new Date( ts );
    var yyyy = dt.getFullYear();
    var mm = dt.getMonth() + 1;
    var dd = dt.getDate();
    var hh = dt.getHours();
    var nn = dt.getMinutes();
    var ss = dt.getSeconds();
    var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
      + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
    return datetime;
  }else{
    return "";
  }
}

function sortByTimestamp( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){
    r = -1;
  }else if( a.timestamp > b.timestamp ){
    r = 1;
  }

  return r;
}


//. api をエクスポート
module.exports = api;
