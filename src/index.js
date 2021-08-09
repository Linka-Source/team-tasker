const { ApolloServer, gql } = require('apollo-server');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const { DB_URI, DB_NAME } = process.env;

const typeDefs = gql`

type Query {
    myTaskLists: [TaskList!]!
  }

  type Mutation {
    signUp(input: SignUpInput!): AuthUser!
    signIn(input: SignInInput!): AuthUser!
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
    myTaskLists: () => []
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
        token: 'token'
      }
    },

    signIn: async (_, { input }, { db }) => {
      const user = await db.collection('Users').findOne({ email: input.email })
    //  if user value doesn't match - throw error
      if (!user) {
        throw new Error('Invalid credentials!');
      }

      // check if the password is correct (compare hashed password with unhashed password)
      const isPasswordCorrect = bcrypt.compareSync(input.password, user.password);
      if (!isPasswordCorrect) {
        throw new Error('Invalid credentials!');
      }

      return {
        user,
        token: 'token',
      }
    }
  },

  // return uder id from database (underscore if using correct reference from db - if that's null, it will return id)
  User: {
    id: ({ _id, id }) => _id || id,
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