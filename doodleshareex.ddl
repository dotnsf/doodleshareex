/* doodleshareex.ddl */

/* images */
drop table images;
create table if not exists images ( id varchar(50) not null primary key, body bytea, contenttype varchar(50) default '', timestamp varchar(50) default '', title varchar(50) default '', comment varchar(256) default '', room varchar(256) default '', uuid varchar(100) default '', migrate_to varchar(100) default '', created bigint default 0, updated bigint default 0 );
