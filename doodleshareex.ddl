/* doodleshareex.ddl */

/* images */
drop table images;
create table if not exists images ( id varchar(50) not null primary key, body bytea, contenttype varchar(50) default '', timestamp varchar(50) default '', name varchar(50) default '', comment varchar(256) default '', room varchar(256) default '', uuid varchar(100) default '', migrate_to varchar(100) default '', created bigint default 0, updated bigint default 0 );

drop table rooms;
create table if not exists rooms ( id varchar(256) not null primary key, uuid varchar(100) default '', basic_id varchar(50) default '', basic_password varchar(50) default '', created bigint default 0, updated bigint default 0 );
