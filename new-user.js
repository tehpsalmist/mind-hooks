const { gql } = require('./graphql')

module.exports = async (req, res) => {
  if (req.get('secret-sauce') !== 'wololo') return res.status(400).json({ success: false })

  const { userId } = req.params

  if (userId) {
    const result = await gql(`mutation insert_users($userId: String) {
      insert_users(objects: {id: $userId}) {
        returning {
          id
        }
      }
    }`, { userId }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

    if (result instanceof Error) {
      return res.status(400).json({ success: false })
    }

    return res.status(200).json({ success: false })
  }
  
  res.status(400).json({ success: false })
}
