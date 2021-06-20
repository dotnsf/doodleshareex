# WebSocket with Redis

## Overview

Trial application which tries to use WebSocket with Redis so that application can be scaled-in/out.


## How to run with docker

- Run Redis image as container:

  - `$ docker run -d --name redisserver -p 6379:6379 redis`

- Run app(s) with PORT as environment variable(Default = 8080):

  - `$ node app`

  - `$ PORT=8081 node app`

  - `$ PORT=8082 node app`

- Access to application(s) with different browsers or different tabs:

  - http://localhost:8080/

  - http://localhost:8081/

  - http://localhost:8082/

- Click `Open WebSocket connection` and `Send` text message in each browsers/tabs. 

  - Confirm each message would be sent to all client


## References

https://qiita.com/rihofujino/items/7bf4b99e2176f63ca7ef

https://github.com/rihofujino/pubsub-demo


## Copyright

2021 [K.Kimura @ Juge.Me](https://github.com/dotnsf) all rights reserved.
