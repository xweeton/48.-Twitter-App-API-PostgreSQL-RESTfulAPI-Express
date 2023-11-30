let express = require('express');
let path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const { DATABASE_URL } = process.env;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

let app = express()
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true,
  },
});

async function getPostgresVersion() {
  const client = await pool.connect();
  try {
    const response = await client.query('SELECT version()');
    console.log(response.rows[0]);
  } finally {
    client.release();
  }
}

getPostgresVersion();

// adding new post
app.post('/posts', async (req, res) => {
  const { title, content, user_id } = req.body;
  const client = await pool.connect();

  try {
    // check if user exists
    const userExists = await client.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if
      //user exists, add post
      (userExists.rows.length > 0) {
      const post = await client.query('INSERT INTO posts (title, content, user_id, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *', [title, content, user_id]);

      //send new post data black to client
      res.json(post.rows[0]);
    } else {
      // user doesnt exist
      res.status(400).json({ error: "User does not exist" });
    }
  } catch (err) {
    console.log(err.stack);
    res.status(500).json({ error: "Something went wrong, please try again later!" });
  } finally {
    client.release();
  }

});

// delete post
app.delete('/posts/:postId', async (req, res) => {
  const { postId } = req.params;
  const client = await pool.connect();

  try {
    // Check if post exists
    const postExists = await client.query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (postExists.rows.length > 0) {
      // Delete associated likes, due to ERROR: update or delete on table "posts" violates foreign key constraint "likes_post_id_fkey" on table "likes" 
      await client.query('DELETE FROM likes WHERE post_id = $1', [postId]);
      // then If post exists, delete post
      await client.query('DELETE FROM posts WHERE id = $1', [postId]);
      res.json({ message: "Post Deleted Successfully" });
    } else {
      // If post does not exist
      res.status(404).json({ error: "Post does not exist" });
    }
  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


//like a post
app.post('/likes', async (req, res) => {
  const { user_id, post_id } = req.body;
  const client = await pool.connect();

  try {
    //check if an inactive like for this user and post already exists
    const prevLike = await client.query(`
      SELECT * FROM LIKES WHERE user_id = $1 AND post_id = $2 AND active = false
    `, [user_id, post_id]);

    if (prevLike.rowCount > 0) {
      //if the inactive like exists, update it to active
      const newLike = await client.query(`
        UPDATE likes SET active = true WHERE id = $1 RETURNING *
      `, [prevLike.rows[0].id]);
      res.json(newLike.rows[0]);
    } else {
      // if it does not exists, insert new like row with active as true
      const newLike = await client.query(`
        INSERT INTO likes (user_id, post_id, created_at, active)
        VALUES ($1, $2, CURRENT_TIMESTAMP, true)
        RETURNING * 
      `, [user_id, post_id]);
      res.json(newLike.rows[0]);
    }
  } catch (error) {
    console.error('Error', error.message)
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
})

//unlike a post
app.put('/likes/:userId/:postId', async (req, res) => {
  const { userId, postId } = req.params;
  const client = await pool.connect();

  try {
    // Update the like row to inactive
    await client.query(`
      UPDATE likes
      SET active = false
      WHERE user_id = $1 AND post_id = $2 AND active = true
    `, [userId, postId]);
    res.json({ message: "The like has been removed successfully!" });
  } catch (error) {
    console.error('Error', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// getting all likes by users for a post
app.get('/likes/post/:post_id', async (req, res) => {
  const { post_id } = req.params;
  const client = await pool.connect();

  try {
    const likes = await client.query('SELECT users.username, users.id AS user_id, likes.id AS likes_id FROM likes INNER JOIN users ON likes.user_id = users.id WHERE likes.post_id = $1 AND active = true', [post_id]);

    // return list of username value only
    res.json(likes.rows);
    // res.json(likes.rows);

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
})


// view count for a post (ALTER TABLE posts ADD COLUMN views INT DEFAULT 0)
app.get('/posts/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    // Fetch the post from the database
    const post = await client.query('SELECT * FROM posts WHERE id = $1', [id]);

    // Increment the view count
    await client.query('UPDATE posts SET views = views + 1 WHERE id = $1', [id]);

    res.json(post.rows[0]);

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


// get posts and username for specific userId
app.get('/posts/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const client = await pool.connect();

  try {
    const posts = await client.query('SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE user_id = $1', [user_id]);
    if (posts.rowCount > 0) {
      res.json(posts.rows);
    } else {
      res.status(404).json({ error: 'No posts found for this user' });
    }

  } catch (error) {
    console.error('Error', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});


// search bar
app.get('/search', async (req, res) => {
  const searchTerm = req.query.q;
  const client = await pool.connect();

  try {
    const search = await client.query('SELECT username FROM users WHERE username ILIKE $1', [`%${searchTerm}%`]);
    res.json(search.rows);
  } catch (error) {
    console.error('Error', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});


// get username by userId
app.get('/users/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const client = await pool.connect();

  try {
    const username = await client.query('SELECT username FROM users WHERE id = $1', [user_id]);
    res.json(username.rows);

  } catch (error) {
    console.error('Error', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});


// --------------------comments------------------
// CREATE TABLE comments (
//   id SERIAL PRIMARY KEY,
//   post_id INT NOT NULL,
//   user_id INT NOT NULL,
//   comment_text TEXT,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   FOREIGN KEY (post_id) REFERENCES posts(id),
//   FOREIGN KEY (user_id) REFERENCES users(id)
// );

// Add a comment to a post
app.post('/comments/:post_id', async (req, res) => {
  const { post_id } = req.params
  const { user_id, comment_text } = req.body;
  const client = await pool.connect();

  try {
    console.log('post_id:', post_id);
    console.log('user_id:', user_id);
    console.log('comment_text:', comment_text);

    const newComment = await client.query('INSERT INTO comments (post_id, user_id, comment_text) VALUES ($1, $2, $3) RETURNING *', [post_id, user_id, comment_text]);

    res.json(newComment.rows[0]);

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


// Delete a comment
app.delete('/comments/:comment_id', async (req, res) => {
  const { comment_id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('DELETE FROM comments WHERE id = $1', [comment_id]);

    res.json({ message: "Like Deleted Successfully" });

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


// Edit a comment
app.put('/comments/:comment_id', async (req, res) => {
  const { comment_id } = req.params;
  const { comment_text } = req.body;
  const client = await pool.connect();

  try {
    const updatedComment = await client.query('UPDATE comments SET comment_text = $1 WHERE id = $2 RETURNING *', [comment_text, comment_id]);

    res.json(updatedComment.rows[0]);

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


// get comments for a post
app.get('/comments/:post_id', async (req, res) => {
  const { post_id } = req.params;
  const client = await pool.connect();

  try {
    const comments = await client.query('SELECT comments.*, users.username FROM comments JOIN users ON comments.user_id = users.id WHERE post_id = $1', [post_id]);
    res.json(comments.rows);

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


// Like a comment
app.post('/comments/like/:comment_id', async (req, res) => {
  const { comment_id } = req.params;
  const client = await pool.connect();

  try {
    const likedComment = await pool.query('UPDATE comments SET comment_likes = comment_likes + 1 WHERE id = $1 RETURNING *', [comment_id]);

    res.json(likedComment.rows[0]);

  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occurred, please try again.');
  } finally {
    client.release();
  }
});


app.get('/', (req, res) => {
  res.status(200).json({ message: "Welcome to the twitter API!" });
});

app.listen(3000, () => {
  console.log('App is listening on port 3000');
});