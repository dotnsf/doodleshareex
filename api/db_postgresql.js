//. db_cloudant.js
var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    crypto = require( 'crypto' ),
    fs = require( 'fs' ),
    { v4: uuidv4 } = require( 'uuid' ),
    api = express();

var settings = require( '../settings' );

//process.env.PGSSLMODE = 'no-verify';
var PG = require( 'pg' );
PG.defaults.ssl = true;
var database_url = 'DATABASE_URL' in process.env ? process.env.DATABASE_URL : settings.database_url; 
var pg_ca = 'PG_CA' in process.env ? process.env.PG_CA : settings.pg_ca;
var pg = null;
var pg_params = { idleTimeoutMillis: ( 3 * 86400 * 1000 ) };
if( database_url ){
  console.log( 'database_url = ' + database_url );
  pg_params.connectionString = database_url;
  if( pg_ca ){
    if( pg_ca.indexOf( '--BEGIN CERTIFICATE--' ) > -1 && pg_ca.indexOf( '--END CERTIFICATE--' ) > -1 ){
      //pg_params.ssl = { ca: pg_ca, rejectUnauthorized: true }; //. #8
      pg_params.ssl = { ca: pg_ca, rejectUnauthorized: false }; //. #18
    }else{
      //pg_params.ssl = { ca: fs.readFileSync( pg_ca, 'utf-8' ), rejectUnauthorized: true };
      pg_params.ssl = { ca: fs.readFileSync( pg_ca, 'utf-8' ), rejectUnauthorized: false };  //. #18
    }
  }else{
    //. #17 PostgreSQL との接続が SSL でなければ、これすらも不要？
    //. この行をコメントにすると、SSL 接続時に PG_CA の指定は必須になる
    //pg_params.ssl = { rejectUnauthorized: false };
    PG.defaults.ssl = false;
    //pg_params.ssl = false;
  }
  //console.log( { pg_params } );
  pg = new PG.Pool( pg_params );
  pg.on( 'error', function( err ){
    console.log( 'error on working', err );
    if( err.code && err.code.startsWith( '5' ) ){
      try_reconnect( 1000 );
    }
  });
}

function try_reconnect( ts ){
  setTimeout( function(){
    console.log( 'reconnecting...' );
    pg = new PG.Pool( pg_params );
    pg.on( 'error', function( err ){
      console.log( 'error on retry(' + ts + ')', err );
      if( err.code && err.code.startsWith( '5' ) ){
        ts = ( ts < 10000 ? ( ts + 1000 ) : ts );
        try_reconnect( ts );
      }
    });
  }, ts );
}


api.use( multer( { dest: '../tmp/' } ).single( 'image' ) );
api.use( bodyParser.urlencoded( { extended: true } ) );
api.use( bodyParser.json() );
api.use( express.Router() );

api.post( '/image', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();  //. Error: The server does not support SSL connections

      var imgpath = req.file.path;
      var imgtype = req.file.mimetype;
      //var imgsize = req.file.size;
      var ext = imgtype.split( "/" )[1];
      var imgfilename = req.file.filename;
      var filename = req.file.originalname;

      var image_id = uuidv4();
      var img = fs.readFileSync( imgpath );
      //var img64 = new Buffer( img ).toString( 'base64' );

      var room = req.body.room;

      var r = await api.readRoom( room );
  //.   status: true=roomは存在している, false=roomは存在していない
  //.   room:   null=roomが存在していない、またはアクセス権がない, not null=roomそのもの

      var is_private = ( r.status && !r.room ) ? 1 : 0;
      var uuid = req.body.uuid;
      var comment = req.body.comment;
      var timestamp = req.body.timestamp;
      var name = req.body.name;
      var ts = ( new Date() ).getTime();

      var sql = "insert into images( id, body, contenttype, timestamp, name, comment, room, is_private, uuid, created, updated ) values( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 )";
      var query = { text: sql, values: [ image_id, img, imgtype, timestamp, name, comment, room, is_private, uuid, ts, ts ] };
      conn.query( query, async function( err, result ){
        fs.unlink( imgpath, function( err ){} );
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err }, null, 2 ) );
          res.end();
        }else{
          var r = { status: true, id: image_id };

          //. #56
          var sql0 = "select * from rooms where id = $1";
          var query0 = { text: sql0, values: [ room ] };
          var r0 = await conn.query( query0 );
          var apikey = null;
          if( r0.rows.length > 0 && result.rows[0].apikey ){
            try{
              apikey = result.rows[0].apikey;
            }catch( e ){
              console.log( {e} );
            }
          }

          if( apikey ){
            var image_url = 'https://doodleshareex.yellowmix.net/db/image?id=' + image_id;
            var r1 = await api.aiOCR( image_url, apikey );
            console.log( {r1} );
            if( r1 && r1.status && r1.content ){
              r.content = r1.content;
            }
          }

          res.write( JSON.stringify( r, null, 2 ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' }, null, 2 ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e }, null, 2 ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

api.get( '/image', async function( req, res ){
  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.query.id;
      var sql = "select * from images where id = $1";
      var query = { text: sql, values: [ id ] };
      conn.query( query, function( err, result ){
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var image = null;
          if( result.rows.length > 0 && result.rows[0].id ){
            try{
              image = result.rows[0];
            }catch( e ){
            }
          }
  
          if( image ){
            res.contentType( image.contenttype );
            res.end( image.body, 'binary' );
          }else{
            res.status( 400 );
            res.write( JSON.stringify( { status: false, error: 'no image' } ) );
            res.end();
          }
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

api.delete( '/image', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.query.id;
      var sql = "delete from images where id = $1";
      var query = { text: sql, values: [ id ] };
      conn.query( query, function( err, result ){
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true } ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});


//. #11
api.readImages = async function( limit, offset, room ){
  return new Promise( async ( resolve, reject ) => {
    var conn = null;
    try{
      if( pg ){
        conn = await pg.connect();

        var sql = "select * from images" + ( room ? " where room = $1" : "" ) + " order by timestamp desc";
        if( limit ){
          sql += " limit " + limit;
        }
        if( offset ){
          sql += " start " + offset;
        }
        var query = { text: sql, values: [] };
        if( room ){
          query.values.push( room );
        }
        conn.query( query, function( err, result ){
          if( err ){
            console.log( err );
            resolve( { status: false, error: err } );
          }else{
            var images = [];
            if( result.rows.length > 0 ){
              try{
                images = result.rows;
              }catch( e ){
              }
            }
  
            resolve( { status: true, images: images } );
          }
        });
      }else{
        resolve( { status: false, error: 'db is not initialized.' } );
      }
    }catch( e ){
      console.log( e );
      resolve( { status: false, error: e } );
    }finally{
      if( conn ){
        conn.release();
      }
    }
  });
}

api.readPublicImages = async function( limit, offset ){
  return new Promise( async ( resolve, reject ) => {
    var conn = null;
    try{
      if( pg ){
        conn = await pg.connect();

        var sql = "select * from images where is_private = 0 order by timestamp desc";
        if( limit ){
          sql += " limit " + limit;
        }
        if( offset ){
          sql += " start " + offset;
        }
        var query = { text: sql, values: [] };
        conn.query( query, function( err, result ){
          if( err ){
            console.log( err );
            resolve( { status: false, error: err } );
          }else{
            var images = [];
            if( result.rows.length > 0 ){
              try{
                images = result.rows;
              }catch( e ){
              }
            }
  
            resolve( { status: true, images: images } );
          }
        });
      }else{
        resolve( { status: false, error: 'db is not initialized.' } );
      }
    }catch( e ){
      console.log( e );
      resolve( { status: false, error: e } );
    }finally{
      if( conn ){
        conn.release();
      }
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


api.get( '/publicimages', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;

  var r = await api.readPublicImages( limit, offset );
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
api.readRoom = async function( id, basic_id, enc_basic_password, enc_room_password ){
  //. resolve( { status: true, room: room, error: '' } );
  //.   status: true=roomは存在している, false=roomは存在していない
  //.   room:   null=roomが存在していない、またはアクセス権がない, not null=roomそのもの
  //.   error:  status=false, または room=null の理由
  return new Promise( async ( resolve, reject ) => {
    var conn = null;
    try{
      if( pg ){
        conn = await pg.connect();  //. no pg_hba.conf entry for host "xx.xx.xx.xx", user "xxxx", database "xxxx", no encryption

        var sql = "select * from rooms where id = $1";
        var query = { text: sql, values: [ id ] };
        conn.query( query, function( err, result ){
          if( err ){
            console.log( err );
            resolve( { status: false, room: null, error: err } );
          }else{
            var room = null;
            if( result.rows.length > 0 && result.rows[0].id ){
              try{
                room = result.rows[0];
              }catch( e ){
              }
            }
    
            if( room ){
              if( !room.basic_id && !room.basic_password ){
                if( !room.room_password ){
                  //. 認証不要
                  resolve( { status: true, room: room } );
                }else{
                  if( ( /* room.id == basic_id && */ room.room_password == enc_basic_password ) ){
                    //. クライアント向け認証が必要で、認証 OK
                    resolve( { status: true, room: room } );
                  }else{
                    //. クライアント向け認証が必要で、認証 NG
                    resolve( { status: true, room: null, error: 'wrong credentials.' } );
                  }
                }
              }else{
                if( room.basic_id == basic_id && room.basic_password == enc_basic_password ){
                  //. 管理者向け認証が必要で、認証 OK
                  resolve( { status: true, room: room } );
                }else{
                  //. 管理者向け認証が必要で、認証 NG
                  if( !room.room_password ){
                    //. でもクライアント向け認証は不要なので OK
                    resolve( { status: true, room: room } );
                  }else{
                    if( ( /* room.id == basic_id && */ room.room_password == enc_room_password ) ){
                      //. クライアント向け認証が必要で、認証 OK
                      resolve( { status: true, room: room } );
                    }else{
                      //. クライアント向け認証が必要で、認証 NG
                      resolve( { status: true, room: null, error: 'wrong credentials.' } );
                    }
                  }
                }
              }
            }else{
              //. 指定の room が見つからなかった場合、この扱いをどうする？
  
              //.   - [ ] 指定の room を自動作成した上でアクセスを認める？
              //.         その場合のパスワードなどはどうする？？
              //room = ...
              //resolve( { status: true, room: room } );
              //.   - [ ] room は作成しないが、アクセス（利用）を認める？
              resolve( { status: false, room: null } );
              //.   - [ ] room を作る前のアクセスは認めない？
              //resolve( { status: false, error: "not found." } );
            }
          }
        });
      }else{
        resolve( { status: false, error: "db is not initialized." } );
      }
    }catch( e ){
      console.log( e );
      resolve( { status: false, error: e } );
    }finally{
      if( conn ){
        conn.release();
      }
    }
  });
}

//. #56
api.setRoomApikey = async function( id, apikey, basic_id, enc_basic_password ){
  return new Promise( async ( resolve, reject ) => {
    var conn = null;
    try{
      if( pg ){
        conn = await pg.connect();  //. no pg_hba.conf entry for host "xx.xx.xx.xx", user "xxxx", database "xxxx", no encryption

        var r = await api.readRoom( id, basic_id, enc_basic_password );
        if( !r.status ){
          //. 指定の room が存在していない
          resolve( { status: false, error: "no room found for id = " + id + "." } );
        }else{
          var room = r.room;
          var ts = ( new Date() ).getTime();

          var sql = "update rooms set apikey = $1, updated = $2 where id = $3";
          var query = { text: sql, values: [ apikey, ts, id ] };
          conn.query( query, async function( err, result ){
            if( err ){
              console.log( err );
              resolve( { status: false, error: err } );
            }else{
              resolve( { status: true, id: id, apikey: apikey } );
            }
          });
        }
      }else{
        resolve( { status: false, error: "db is not initialized." } );
      }
    }catch( e ){
      console.log( e );
      resolve( { status: false, error: e } );
    }finally{
      if( conn ){
        conn.release();
      }
    }
  });
}

//. #56
var OpenAI = require( 'openai' );
var DEFAULT_MODEL = 'DEFAULT_MODEL' in process.env && process.env.DEFAULT_MODEL ? process.env.DEFAULT_MODEL : 'gpt-4o-mini';
api.aiOCR = async function( image_url, apikey, model, prompt ){
  return new Promise( async ( resolve, reject ) => {
    try{
      if( apikey ){
        var openai = new OpenAI( { apiKey: apikey } );
        if( !model ){ model = DEFAULT_MODEL; }
        if( !prompt ){ prompt = '画像にどんな文字が書かれていますか？書かれている文字を教えてください。'; }

        var completion = await openai.chat.completions.create({
          model: model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: image_url
                }
              }
            ]
          }]
        });
        console.log( {completion} );

        if( completion && completion.choices && completion.choices[0] && completion.choices[0].message ){
          resolve( { status: true, content: completion.choices[0].message.content } );
        }else{
          resolve( { status: false, error: 'no content found.', completion: completion } );
        }
      }else{
        resolve( { status: false, error: 'no apikey specified.' } );
      }
    }catch( e ){
      console.log( e );
      resolve( { status: false, error: e } );
    }
  });
}

api.post( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.params.id;
      if( id.toLowerCase() == 'default' ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "default room can't be edited." } ) );
        res.end();
      }else{
        var r = await api.readRoom( id );
        if( !r.status ){
          //. 指定の room が存在していないことを確認できたので、作成
          var uuid = req.body.uuid;
          var basic_id = req.body.basic_id;
          var basic_password = req.body.basic_password;
          var enc_basic_password = getHash( basic_password );
          var room_password = req.body.room_password;
          var enc_room_password = getHash( room_password );
          var ts = ( new Date() ).getTime();

          var room_type = ( 'type' in req.body && req.body.type  ) ? 1 : 0;

          var sql = "insert into rooms( id, uuid, basic_id, basic_password, room_password, type, created, updated, expire ) values( $1, $2, $3, $4, $5, $6, $7, $8, $9 )";
          var query = { text: sql, values: [ id, uuid, basic_id, enc_basic_password, enc_room_password, room_type, ts, ts, ts+30*24*60*60*1000 ] };
          conn.query( query, async function( err, result ){
            if( err ){
              console.log( err );
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              /* 作成時のみ権利を消費する */
              if( basic_password ){
                await api.deleteUserType( uuid );
              }
              res.write( JSON.stringify( { status: true } ) );
              res.end();
            }
          });
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: 'room existed.' } ) );
          res.end();
        }
      }
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

api.get( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( pg ){
    var id = req.params.id;
    var uuid = req.body.uuid;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );
    var room_password = req.body.room_password;
    var enc_room_password = getHash( room_password );
    var r = await api.readRoom( id, basic_id, enc_basic_password, enc_room_password );
    if( r.status ){
      if( r.room ){
        res.write( JSON.stringify( { status: true, room: r.room } ) );
        res.end();
      }else{
        //. 存在しているが権限が足りない
        var r = await api.readRoom( id, null, null, enc_room_password );
        if( r.status && r.room ){
          res.write( JSON.stringify( { status: true, room: r.room } ) );
          res.end();
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: r.error } ) );
          res.end();
        }
      }
    }else{
      //. 存在していない
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: "not existed." } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.put( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.params.id;
      if( id.toLowerCase() == 'default' ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: "default room can't be edited." } ) );
        res.end();
      }else{
        var uuid = req.body.uuid;
        var basic_id = req.body.basic_id;
        var basic_password = req.body.basic_password;
        var enc_basic_password = getHash( basic_password );
        var r = await api.readRoom( id, basic_id, enc_basic_password );
        if( r.status ){
          if( r.room ){
            var new_basic_id = req.body.new_basic_id;
            var new_basic_password = req.body.new_basic_password;
            var enc_new_basic_password = getHash( new_basic_password );
            var new_room_password = req.body.new_room_password;
            var enc_new_room_password = getHash( new_room_password );
            var ts = ( new Date() ).getTime();

            var sql = "update rooms set basic_id = $1, basic_password = $2, room_password = $3, updated = $4 where id = $5";
            var query = { text: sql, values: [ new_basic_id, enc_new_basic_password, enc_new_room_password, ts, id ] };
            conn.query( query, async function( err, result ){
              if( err ){
                console.log( err );
                res.status( 400 );
                res.write( JSON.stringify( { status: false, error: err } ) );
                res.end();
              }else{
                /* 更新時は権利を消費しない
                //. でもこれだと作成時にパスワード無し＆更新時にパスワード有りが無料でできてしまう
                //. パスワード無しからパスワード有りへの変更は認めないルールが必要
                if( new_basic_password ){
                  await api.deleteUserType( uuid );
                }
                */
                res.write( JSON.stringify( { status: true } ) );
                res.end();
              }
            });
          }else{
            res.status( 400 );
            res.write( JSON.stringify( { status: false, error: r.error } ) );
            res.end();
          }
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
      }
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

//. #56
api.put( '/roomapikey/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var room = req.params.id;
  if( room.toLowerCase() == 'default' ){
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: "default room can't be edited." } ) );
    res.end();
  }else{
    var current_apikey = req.body.current_apikey;
    var new_apikey = req.body.new_apikey;
    var basic_id = req.body.basic_id;
    var basic_password = req.body.basic_password;
    var enc_basic_password = getHash( basic_password );

    var r0 = await api.readRoom( room, basic_id, enc_basic_password );
    if( r0.status && r0.room && r0.room.id && r0.room.id == room && r0.room.apikey == current_apikey ){
      var r1 = await api.setRoomApikey( room, new_apikey, basic_id, enc_basic_password );

      res.write( JSON.stringify( r1 ) );
      res.end();
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: "failed to update room apikey for " + room + "." } ) );
      res.end();
    }
  }
});

api.delete( '/room/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.params.id;
      var uuid = req.body.uuid;
      var basic_id = req.body.basic_id;
      var basic_password = req.body.basic_password;
      var enc_basic_password = getHash( basic_password );
      var r = await api.readRoom( id, basic_id, enc_basic_password );
      if( r.status ){
        if( r.room ){
          var sql = "delete from rooms where id = $1";
          var query = { text: sql, values: [ id ] };
          conn.query( query, function( err, result ){
            if( err ){
              console.log( err );
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true } ) );
              res.end();
            }
          });
        }else{
          //. 存在しているが権限が足りない
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: r.error } ) );
          res.end();
        }
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
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

api.get( '/rooms', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var uuid = req.query.uuid ? req.query.uuid : '';

  var conn = null;
  try{
    if( pg && uuid ){
      conn = await pg.connect();

      var sql = "select * from rooms where uuid = $1 order by updated desc";
      if( limit ){
        sql += " limit " + limit;
      }
      if( offset ){
        sql += " start " + offset;
      }
      var query = { text: sql, values: [ uuid ] };
      conn.query( query, function( err, result ){
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var rooms = [];
          if( result.rows.length > 0 ){
            try{
              rooms = result.rows;
            }catch( e ){
            }
          }
  
          var result = { status: true, limit: limit, offset: offset, rooms: rooms };
          res.write( JSON.stringify( result, null, 2 ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
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

//. #33
//. getUser
api.getUser = async function( user_id ){
  return new Promise( async ( resolve, reject ) => {
    if( pg ){
      var conn = await pg.connect();
      if( conn ){
        try{
          var sql = "select * from users where id = $1";
          var query = { text: sql, values: [ user_id ] };
          conn.query( query, function( err, result ){
            if( err ){
              console.log( err );
              resolve( { status: false, error: err } );
            }else{
              if( result && result.rows && result.rows.length > 0 ){
                resolve( { status: true, user: result.rows[0] } );
              }else{
                //resolve( { status: false, error: 'no data' } );
                var t = ( new Date() ).getTime();
                sql = "insert into users ( id, type, created, updated ) values ( $1, $2, $3, $4 )";
                query = { text: sql, values: [ user_id, 0, t, t ] };
                conn.query( query, function( err, result ){
                  if( err ){
                    console.log( err );
                    resolve( { status: false, error: err } );
                  }else{
                    resolve( { status: true, user: { id: user_id, type: 0, created: t, updated: t } } );
                  }
                });
              }
            }
          });
        }catch( e ){
          console.log( e );
          resolve( { status: false, error: err } );
        }finally{
          if( conn ){
            conn.release();
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

//. addUserType
api.addUserType = async function( user_id ){
  return new Promise( async ( resolve, reject ) => {
    if( pg ){
      var conn = await pg.connect();
      if( conn ){
        if( !user_id ){
          resolve( { status: false, error: 'no id.' } );
        }else{
          try{
            var r = await this.getUser( user_id );
            if( r && r.status && r.user ){
              var sql = 'update users set type = type + 1, updated = $1 where id = $2';
              var t = ( new Date() ).getTime();
              var query = { text: sql, values: [ t, user_id ] };
              conn.query( query, function( err, result ){
                if( err ){
                  console.log( err );
                  resolve( { status: false, error: err } );
                }else{
                  resolve( { status: true, result: result } );
                }
              });
            }else{
              var sql = 'insert into users ( id, type, created, updated ) values ( $1, $2, $3, $4 )';
              var t = ( new Date() ).getTime();
              var query = { text: sql, values: [ user_id, user_type, t, t ] };
              conn.query( query, function( err, result ){
                if( err ){
                  console.log( err );
                  resolve( { status: false, error: err } );
                }else{
                  resolve( { status: true, result: result } );
                }
              });
            }
          }catch( e ){
            console.log( e );
            resolve( { status: false, error: err } );
          }finally{
            if( conn ){
              conn.release();
            }
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

//. deleteUserType
api.deleteUserType = async function( user_id ){
  return new Promise( async ( resolve, reject ) => {
    if( pg ){
      var conn = await pg.connect();
      if( conn ){
        if( !user_id ){
          resolve( { status: false, error: 'no id.' } );
        }else{
          try{
            var r = await this.getUser( user_id );
            if( r && r.status && r.user ){
              if( r.user.type ){
                var sql = 'update users set type = type - 1, updated = $1 where id = $2';
                var t = ( new Date() ).getTime();
                var query = { text: sql, values: [ t, user_id ] };
                conn.query( query, function( err, result ){
                  if( err ){
                    console.log( err );
                    resolve( { status: false, error: err } );
                  }else{
                    resolve( { status: true, result: result } );
                  }
                });
              }else{
                resolve( { status: false, error: 'not enough type.' } );
              }
            }else{
              var sql = 'delete from users where id = $1';
              var t = ( new Date() ).getTime();
              var query = { text: sql, values: [ user_id ] };
              conn.query( query, function( err, result ){
                if( err ){
                  console.log( err );
                  resolve( { status: false, error: err } );
                }else{
                  resolve( { status: true, result: result } );
                }
              });
            }
          }catch( e ){
            console.log( e );
            resolve( { status: false, error: err } );
          }finally{
            if( conn ){
              conn.release();
            }
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

//. deleteExpiredRooms
api.deleteExpiredRooms = async function(){
  return new Promise( async ( resolve, reject ) => {
    if( pg ){
      var conn = await pg.connect();
      if( conn ){
        try{
          var sql = 'delete from rooms where type = 0 and expire < $1';
          var t = ( new Date() ).getTime();
          var query = { text: sql, values: [ t ] };
          conn.query( query, function( err, result ){
            if( err ){
              console.log( err );
              resolve( { status: false, error: err } );
            }else{
              resolve( { status: true, result: result } );
            }
          });
        }catch( e ){
          console.log( e );
          resolve( { status: false, error: e } );
        }finally{
          if( conn ){
            conn.release();
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

api.delete( '/expiredrooms', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var result = await api.deleteExpiredRooms();

  res.write( JSON.stringify( result, null, 2 ) );
  res.end();
});

//. #62 extendRoom
api.extendRoom = async function( room, days = 30 ){
  return new Promise( async ( resolve, reject ) => {
    if( pg ){
      var conn = await pg.connect();
      if( conn ){
        try{
          var extendms = days * 24 * 60 * 60 * 1000;
          var t = ( new Date() ).getTime();
          var sql = 'update rooms set expire = expire + ' + extendms + ', updated = $1 where id = $2';
          var query = { text: sql, values: [ t, room ] };
          conn.query( query, function( err, result ){
            if( err ){
              console.log( err );
              resolve( { status: false, error: err } );
            }else{
              resolve( { status: true, result: result } );
            }
          });
        }catch( e ){
          console.log( e );
          resolve( { status: false, error: e } );
        }finally{
          if( conn ){
            conn.release();
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

//. createTransaction
api.createTransaction = async function( transaction_id, user_id, order_id, amount, currency ){
  return new Promise( async function( resolve, reject ){
    if( pg ){
      conn = await pg.connect();
      if( conn ){
        try{
          var sql = 'insert into transactions( id, user_id, order_id, amount, currency, created, updated ) values ( $1, $2, $3, $4, $5, $6, $7 )';
          var t = ( new Date() ).getTime();
          var query = { text: sql, values: [ transaction_id, user_id, order_id, amount, currency, t, t ] };
          conn.query( query, function( err, result ){
            if( err ){
              console.log( err );
              resolve( { status: false, error: err } );
            }else{
              resolve( { status: true, result: result } );
            }
          });
        }catch( e ){
          console.log( e );
          resolve( { status: false, error: err } );
        }finally{
          if( conn ){
            conn.release();
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

//. getTransactions
api.getTransactions = async function( limit, offset ){
  return new Promise( async function( resolve, reject ){
    if( pg ){
      conn = await pg.connect();
      if( conn ){
        try{
          var sql = "select * from transactions order by created desc";
          if( limit ){
            sql += " limit " + limit;
          }
          if( offset ){
            sql += " start " + offset;
          }
          var query = { text: sql, values: [] };
          conn.query( query, function( err, result ){
            if( err ){
              console.log( err );
              resolve( { status: false, error: err } );
            }else{
              resolve( { status: true, result: result.rows } );
            }
          });
        }catch( e ){
          console.log( e );
          resolve( { status: false, error: err } );
        }finally{
          if( conn ){
            conn.release();
          }
        }
      }else{
        resolve( { status: false, error: 'no connection.' } );
      }
    }else{
      resolve( { status: false, error: 'db not ready.' } );
    }
  });
};

api.get( '/delete_user_type', async function( req, res ){
  var user_id = req.query.user_id;
  if( user_id ){
    await api.deleteUserType( user_id );
  }
  res.redirect( '/auth' );
});



//. api をエクスポート
module.exports = api;
