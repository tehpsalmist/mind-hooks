const { gql } = require('./graphql')
const { validateRequest } = require('./utilities')

const rejected = validateRequest({
  tableName: 'players',
  operation: 'DELETE',
  dataKeys: ['old'],
  excludeAdminEvents: true
})

module.exports = async (req, res) => {
  if (rejected(req)) {
    return res.status(204).json({ message: 'irrelevant trigger' })
  }

  const player = req.body.event.data.old
  
  const data = await gql(`{
    games_by_pk(id: ${player.game_id}) {
      id
      owner_id
      player_count
      is_full
      players {
        user_id
      }
      players_aggregate {
        aggregate {
          count
        }
      }
    }
  }`).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
  if (data instanceof Error) {
    return res.status(500).json({ success: false })
  }
  
  if (!data || !data.games_by_pk) {
    return res.status(204).json({ message: 'irrelevant trigger' })
  }
  
  const game = data.games_by_pk
  
  if (game.owner_id === player.user_id) {
    const result = await gql(`
      mutation delete_games_and_players($gameId: Int) {
        delete_players(where: {game_id: {_eq: $gameId}}) {
          affected_rows
        }
        delete_messages(where: {game_id: {_eq: $gameId}}) {
          affected_rows
        }
        delete_games(where: {id: {_eq: $gameId}}) {
          affected_rows
        }
      }
    `, { gameId: game.id }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
    if (result instanceof Error) {
      return res.status(500).json({ success: false })
    }
  }
  
  if (game.players_aggregate.aggregate.count < game.player_count && game.is_full) {
    const result = await gql(`mutation update_games($gameId: Int) {
      update_games(where: {id: {_eq: $gameId}}, _set: {is_full: false}) {
        affected_rows
      }
    }`, { gameId: game.id }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
    if (result instanceof Error) {
      return res.status(500).json({ success: false })
    }
  }

  res.status(200).json({ success: true })
}