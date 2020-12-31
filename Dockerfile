FROM node:12-stretch

USER node

RUN mkdir /home/node/task_scheduler

WORKDIR /home/node/task_scheduler

COPY --chown=node:node master/package.json master/package.json 

RUN cd master && yarn

COPY --chown=node:node worker/package.json worker/package.json 

RUN cd worker && yarn

COPY --chown=node:node . .

CMD ["sh"]