const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("The server is Running");
    });
  } catch (e) {
    console.log(`DB error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

function validatePassword(password) {
  return password.length > 5;
}

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "VAISHNAVI", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

//register user api
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `select * from user where username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    if (validatePassword(password) === true) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const PostUserQuery = `
                insert into user(username, password, name ,gender)
                values('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await db.run(PostUserQuery);
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

//login user api
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `select * from user where username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "VAISHNAVI");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//latest tweets
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getTweets = `
    SELECT
        DISTINCT username,
        tweet,
        date_time as dateTime
    FROM
        (user INNER JOIN follower ON user.user_id = follower.follower_user_id) as T
        NATURAL JOIN tweet
    WHERE user.user_id in(
        SELECT 
            follower.following_user_id
        FROM 
            user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE 
            username = '${username}')
    ORDER BY
        dateTime DESC
    LIMIT 4;
    `;
  const tweets = await db.all(getTweets);
  response.send(tweets);
});

//user following
app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getFollowers = `
    SELECT 
        DISTINCT name
    FROM
        user INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE
        user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id =(
            SELECT 
                user_id 
            FROM
                USER
            WHERE 
                username = '${username}'
        ));
    `;
  const followers = await db.all(getFollowers);
  response.send(followers);
});

//user followers
app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getFollowerQuery = `
    SELECT 
        DISTINCT name
    FROM
        user INNER JOIN follower
            ON user.user_id = follower.follower_user_id
    WHERE 
        user_id IN (select follower_user_id from follower 
            where following_user_id in (select user_id from user where username = '${username}'));
            `;
  const followersList = await db.all(getFollowerQuery);
  response.send(followersList);
});

//get tweets
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  let { username } = request;
  const { tweetId } = request.params;
  const getUserQuery = `
  select user_id from tweet where tweet_id = '${tweetId}';
  `;
  const dbUser = await db.get(getUserQuery);
  const requestedUserQuery = `
  select user_id from user where username = '${username}';
  `;
  const requestedUser = await db.get(requestedUserQuery);
  const getFollowingQuery = `select following_user_id from follower where follower_user_id = '${requestedUser.user_id}';`;
  const following = await db.all(getFollowingQuery);
  const usersFollowingArr = following.map((i) => i.following_user_id);
  if (usersFollowingArr.includes(dbUser.user_id)) {
    const getTweetQuery = `
    select 
        tweet,
        count(distinct like_id) as likes,
        count(distinct reply_id) as replies,
        date_time as dateTime
    from
        (tweet inner join reply on tweet.tweet_id = reply.tweet_id) as t
        inner join like on t.tweet_id = like.tweet_id
    where
        tweet.tweet_id = '${tweetId}';
    `;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//users liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `
            select user_id from tweet where tweet_id = '${tweetId}';
        `;
    const dbUser = await db.get(getUserQuery);
    const requestedUserQuery = `
        select user_id from user where username = '${username}';
        `;
    const requestedUser = await db.get(requestedUserQuery);
    const getFollowingQuery = `select following_user_id from follower where follower_user_id = '${requestedUser.user_id}';`;
    const following = await db.all(getFollowingQuery);
    const usersFollowingArr = following.map((i) => i.following_user_id);
    if (usersFollowingArr.includes(dbUser.user_id)) {
      const getUserIdQuery = `
        select
            user_id
        from 
            like
        where tweet_id = '${tweetId}';`;
      const userIdList = await db.all(getUserIdQuery);
      userIdArr = userIdList.map((i) => i.user_id);
      const getUsersWhoLiked = `
        SELECT 
            username
        FROM    
            user
        WHERE   
            user_id IN (${userIdArr});
      `;
      const usernames = await db.all(getUsersWhoLiked);
      const usersList = usernames.map((i) => i.username);
      response.send({ likes: usersList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `
            select user_id from tweet where tweet_id = '${tweetId}';
        `;
    const dbUser = await db.get(getUserQuery);
    const requestedUserQuery = `
        select user_id from user where username = '${username}';
        `;
    const requestedUser = await db.get(requestedUserQuery);
    const getFollowingQuery = `select following_user_id from follower where follower_user_id = '${requestedUser.user_id}';`;
    const following = await db.all(getFollowingQuery);
    const usersFollowingArr = following.map((i) => i.following_user_id);
    if (usersFollowingArr.includes(dbUser.user_id)) {
      const getUserIdQuery = `
        select
            user_id
        from 
            reply
        where tweet_id = '${tweetId}';`;
      const userIdList = await db.all(getUserIdQuery);
      userIdArr = userIdList.map((i) => i.user_id);
      const getUsersWhoReplied = `
        SELECT 
            name,
            reply
        FROM    
            user natural join reply
        WHERE   
            user_id IN (${userIdArr});
      `;
      const repliedUsers = await db.all(getUsersWhoReplied);
      response.send({ replies: repliedUsers });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
//
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUserId = `select user_id from user where username = '${username}';`;
  const dbId = await db.get(getUserId);
  const getTweets = ` select tweet, count(distinct like_id) as likes, count(distinct reply_id) as replies, date_time as dateTime
   from (tweet inner join like on tweet.user_id = like.user_id) as t inner join reply on t.user_id = reply.user_id
    where tweet.user_id = '${dbId.user_id}';`;
  const tweets = await db.all(getTweets);
  response.send(tweets);
});
//
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  const { tweet } = request.body;
  const getUserId = `select user_id from user where username = '${username}';`;
  const dbId = await db.get(getUserId);
  const createTweet = `insert into tweet(tweet , user_id, date_time) 
  values('${tweet}','${dbId.user_id}','${new Date()}');`;
  await db.run(createTweet);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getUserId = `select user_id from user where username = '${username}';`;
    const dbId = await db.get(getUserId);
    const getTweetIds = `select tweet_id from tweet where user_id = '${dbId.user_id}';`;
    const tweets = await db.all(getTweetIds);
    const tweetIdArr = tweets.map((i) => i.tweet_id);
    if (tweetIdArr.includes(parseInt(tweetId))) {
      const deleteQuery = `delete from tweet where tweet_id = '${tweetId}';`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
