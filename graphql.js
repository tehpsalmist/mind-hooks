const { GraphQLClient } = require('graphql-request')

const client = new GraphQLClient('https://the-mind.herokuapp.com/v1/graphql', {
  headers: {
    'X-Hasura-Admin-Secret': process.env.X_HASURA_ADMIN_SECRET
  }
})

exports.gql = (query, variables) => client.request(query, variables)