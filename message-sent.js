const { validateRequest } = require('./utilities')
const { gql } = require('./graphql')

const rejected = validateRequest({
  tableName: 'messages',
  operation: 'INSERT',
  dataKeys: ['new'],
  excludeAdminEvents: true,
})

module.exports = async (req, res) => {
  if (rejected(req)) {
    res.status(204).json({ message: 'irrelevant trigger' })
  }
  
  const message = req.body.event.data.new
  
  const data = message.game_id 
    ? await gql(`
      query messages($gameId: Int) {
        messages(where: {game_id: {_eq: $gameId}}, order_by: {created_at: desc}) {
          id
          created_at
        }
      }
    `, { gameId: message.game_id }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    : await gql(`
      query {
        messages(where: {game_id: {_is_null: true}}, order_by: {created_at: desc}) {
          id
          created_at
        }
      }
    `).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
  
  if (data instanceof Error) {
    return res.status(500).json({ message: 'Error getting message list' })
  }
  
  if (!data || !data.messages || data.messages.length <= 20) {
    return res.status(200).json({ success: true })
  }

  const deletion = await gql(`
    mutation deleteMessages($messageIds: [Int!]) {
      delete_messages(where: {id: {_in: $messageIds}}) {
        affected_rows
      }
    }
  `, {
    messageIds: data.messages.slice(20).map(({ id }) => id)
  }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
  
  if (deletion instanceof Error) {
    return res.status(500).json({ message: 'Error deleting messages' })
  }

  return res.status(200).json({ success: true })
}