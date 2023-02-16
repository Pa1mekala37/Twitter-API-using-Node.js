const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();
app.use(express.json());
let db = null;

const init = async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  app.listen(3000, () => {
    console.log("server is running at http://localhost:3000");
  });
};
init();

app.post("/register/", async (request, response) => {
  const { username, password, gender, name } = request.body;
  const dbUser = await db.get(
    `Select * From user where username = "${username}";`
  );
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(`
        INSERT INTO user 
        (username,password, gender, name )
        values 
        ("${username}","${hashedPassword}","${gender}","${name}");
        `);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// get all users

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const dbUser = await db.get(
    `Select * From user where username = "${username}";`
  );
  if (dbUser !== undefined) {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatch) {
      let jwtToken = jwt.sign(username, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

function authenticateToken(request, response, next) {
  let jwtToken;

  const authorization = request.headers["authorization"];
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
}

const tweetResponse = (dbObject) => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
});

// user tweets api
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweets = await db.all(`
    select 
    tweet.tweet_id,
    tweet.user_id,
    user.username,
    tweet.tweet,
    tweet.date_time
    from 
    follower
    left join tweet on tweet.user_id = follower.following_user_id
    left join user on follower.following_user_id = user.user_id
    where follower.follower_user_id = (select user_id from user where username = "${request.username}")
    order by tweet.date_time desc
    limit 4;
    `);
  response.send(latestTweets.map((item) => tweetResponse(item)));
});

// all the people who the logged user if following
app.get("/user/following/", authenticateToken, async (request, response) => {
  const following = await db.all(`
    select 
    user.name
    from 
    follower
    left join user on follower.following_user_id = user.user_id
    where follower.follower_user_id = (select user_id from user where username = "${request.username}");
  `);
  response.send(following);
});

// get all the followers of the logged in user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const followers = await db.all(`
    select 
    user.name
    from 
    follower
    left join user on follower.follower_user_id = user.user_id
    where follower.following_user_id = (select user_id from user where username = "${request.username}");
    `);
  response.send(followers);
});

const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`
      select * from follower
      where
      follower_user_id =  (select user_id from user where username = "${request.username}")
      and 
      following_user_id = (select user.user_id from tweet natural join user where tweet_id = ${tweetId});
      `);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// get tweet with tweet id
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(`
      select tweet,date_time from tweet where tweet_id = ${tweetId};`);
    const { likes } = await db.get(`
select count(like_id) as likes from like where tweet_id = ${tweetId};`);
    const { replies } = await db.get(`
select count(reply_id) as replies from reply where tweet_id = ${tweetId};`);
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

// get all likes of a tweet with tweet id if the user follows the tweeter

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedBy = await db.all(`
    select user.username from
    like natural join user
    where tweet_id = ${tweetId};
    `);
    response.send({ likes: likedBy.map((item) => item.username) });
  }
);

// get all replies of a tweet with tweet id if the user follows the tweeter

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await db.all(`
    select user.name, reply.reply from
    reply natural join user
    where tweet_id = ${tweetId};
    `);
    response.send({ replies });
  }
);

// get all the tweet by the logged user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const myTweets = await db.all(`
    select 
    tweet.tweet,
    count(distinct like.like_id) as likes,
    count(distinct reply.reply_id) as replies,
    tweet.date_time
    from
    tweet
    left join like on tweet.tweet_id = like.tweet_id
    left join reply on tweet.tweet_id = reply.tweet_id
    where tweet.user_id = (select user_id from user where username = "${request.username}")
    group by tweet.tweet_id;
    `);
  response.send(
    myTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});

// post a tweet by the logged in user

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `select user_id from user where username = "${request.username}"`
  );
  await db.run(`
    Insert into tweet
    (tweet, user_id)
    values
    ("${tweet}",${user_id});
    `);
  response.send("Created a Tweet");
});

// delete a tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await db.get(`
  select 
  tweet_id, user_id
  from 
  tweet 
  where tweet_id = ${tweetId}
  and user_id = (select user_id from user where username = "${request.username}");
  `);
    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId}
        `);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
