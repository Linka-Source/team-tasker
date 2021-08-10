const { ApolloServer, gql } = require('apollo-server');
const { MongoClient, ObjectID } = require('mongodb');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

// user will have to sign up again after 14 days when the token expires
const getToken = (user) => jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '14 days' });

const getUserFromToken = async (token, db) => {
  if (!token) { return null }
// token must contain id to be valid
  const tokenData = jwt.verify(token, JWT_SECRET);
  if (!tokenData?.id) {
    return null;
  }
  return await db.collection('Users').findOne({ _id: ObjectID(tokenData.id) });
}

const typeDefs = gql`

type Query {
    myTaskLists: [TaskList!]!
  }

  type Mutation {
    signUp(input: SignUpInput!): AuthUser!
    signIn(input: SignInInput!): AuthUser!
# returns created tasklist and defines tasklist input
    createTaskList(title: String!): TaskList!
    updateTaskList(id: ID!, title: String!): TaskList!
    deleteTaskList(id: ID!): Boolean!
    # add/invite collaborators
    addUserToTaskList(taskListId: ID!, userId: ID!): TaskList

    # create tasks
    createToDo(content: String!, taskListId: ID!): ToDo!
  }

  input SignUpInput {
    email: String!
    password: String!
    name: String!
    avatar: String
  }

  input SignInInput {
    email: String!
    password: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
  }

  type TaskList {
    id: ID!
    createdAt: String!
    title: String!
    progress: Float!
    users: [User!]!
    todos: [ToDo!]!
    # returns the array and the values inside the array
  }

  type ToDo {
    id: ID!
    content: String!
    isCompleted: Boolean!
    taskList: TaskList!
  }
`;

const resolvers = {
  Query: {
    myTaskLists: async (_, __, { db, user }) => {
      if (!user) { throw new Error('Authentication Error. Please sign in!'); }

      return await db.collection('TaskList') .find({ userIds: user._id }) .toArray();
  },

    getTaskList: async(_, { id }, { db, user }) => {
      if (!user) { throw new Error('Authentication Error. Please sign in'); }
    
      return await db.collection('TaskList').findOne({ _id: ObjectID(id) });
    }
  },

  Mutation: {
    signUp: (_, { input }, { db }) => {
      const hashedPassword = bcrypt.hashSync(input.password);
      const newUser = {
        ...input,
        password: hashedPassword,
      }

      // save to database
      const result = await db.collection('Users').insert(newUser);
      console.log(result);

      // return first item from the array
      const user = result.ops[0]
      return {
        user,
        token: getToken(user),
      }
    },

    signIn: async (_, { input }, { db }) => {
      const user = await db.collection('Users').findOne({ email: input.email });

      // check if the password is correct (compare hashed password with unhashed password)
      const isPasswordCorrect = user && bcrypt.compareSync(input.password, user.password);
       //  if user value doesn't match - throw error
       if (!user|| !isPasswordCorrect) {
        throw new Error('Invalid credentials!');
      }

      return {
        user,
        token: getToken(user),
      }
    },

    // create tasklist
    createTaskList: async(_, { title }, { db, user }) => {
      // only an authenticated user can use tasklist
      if (!user) {
        throw new Error('Authentication Error. Please sign in!');
      }

      const newTaskList = {
        title,
        createdAt: new  Date () .toISOString(),
        userIDs: [user._id]
      }

      // insert above object (new tasklist) into database
      const result = await db.collection('TaskList').insert(newTaskList);
      return result.ops[0];
  },

  // update tasklist
   updateTaskList: async(_, { id, title }, { db, user }) => {
     if (!user) { throw new Error('Authentication Error. Please sign in'); }

     const result = await db.collection('TaskList') .updateOne({
     // which tasklist do we want to update - picked by id
      _id: ObjectID(id)}, 
     {
       $set: { title }
     })
     // update database
     return await db.collection('TaskList').findOne({ _id: ObjectID(id) });
   },

  //  invite collaborators to tasklists by id
   addUserToTaskList: async(_, { taskListId, userId }, { db, user }) => {
    if (!user) { throw new Error('Authentication Error. Please sign in'); }

    const taskList = await db.collection('TaskList').findOne({ _id: ObjectID(taskListId) });
    if (!taskList) {
      return null;
    }
    if (taskList.userIds.find((dbId) => dbId.toString() === userId.toString())) {
      return taskList;
    }
    await db.collection('TaskList')
            .updateOne({
              _id: ObjectID(taskListId)
            }, {
              $push: {
                userIds: ObjectID(userId),
              }
            })
    taskList.userIds.push(ObjectID(userId))
    return taskList;
  },

    // delete tasklist
    deleteTaskList: async(_, { id }, { db, user }) => {
      if (!user) { throw new Error('Authentication Error. Please sign in'); }
    
       // only collaborators of this task list can delete tasklist (by id)
      await db.collection('TaskList').removeOne({ _id: ObjectID(id) });

      return true;
   },

   // create ToDo task items
   createToDo: async(_, { content, taskListId }, { db, user }) => {
    if (!user) { throw new Error('Authentication Error. Please sign in'); }
    const newToDo = {
      content, 
      taskListId: ObjectID(taskListId),
      isCompleted: false,
    }
    const result = await db.collection('ToDo').insert(newToDo);
    return result.ops[0];
  },


    // return uder id from database (underscore if using correct reference from db - if that's null, it will return id)
    User: {
      id: ({ _id, id }) => _id || id,
    }

    TaskList: {
      id: ({ _id, id }) => _id || id,
      progress: () => 0,
      users: async ({ userIDs }, _, { db }) => Promise.all(
       userIDs.map((userID) => (
         db.collection('User').findOne({ _id: userID }))
          )
     }
   }
  };
  

const start = async () => {
  const client = new MongoClient(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const db = client.db(DB_NAME);

  // The ApolloServer constructor requires two parameters: the schema definition and the set of resolvers.
  const server = new ApolloServer({ 
    typeDefs, 
    resolvers, 
    context: async ({ req }) => {
      const user = await getUserFromToken(req.headers.authorization, db);
      return {
        db,
        user,
      }
    },
  });

  // The `listen` method launches a web server.
  server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
}

start();