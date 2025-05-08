/* doodleshareex.ddl */

/* images */
drop table images;
create table if not exists images ( id varchar(50) not null primary key, body bytea, contenttype varchar(50) default '', timestamp varchar(50) default '', name varchar(50) default '', comment varchar(256) default '', room varchar(256) default '', is_private int default 1, uuid varchar(100) default '', migrate_to varchar(100) default '', created bigint default 0, updated bigint default 0 );

/* rooms */
drop table rooms;
create table if not exists rooms ( id varchar(256) not null primary key, uuid varchar(100) default '', basic_id varchar(50) default '', basic_password varchar(50) default '', room_password varchar(50) default '', apikey varchar(512) default '', type smallint default 0, created bigint default 0, updated bigint default 0, expire bigint default 0 );

/* users */
drop table users;
create table if not exists users ( id varchar(50) not null primary key, type int default 0, created bigint default 0, updated bigint default 0 );

/* transactions */
drop table transactions;
create table if not exists transactions ( id varchar(100) not null primary key, user_id varchar(50) not null, order_id varchar(50) not null, amount int default 0, currency varchar(10) default '', created bigint default 0, updated bigint default 0 );
