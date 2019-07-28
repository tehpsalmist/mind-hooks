const { gql } = require('./graphql')
const { validateRequest } = require('./utilities')

const rejected = validateRequest({
  tableName: 'players',
  operation: 'INSERT',
  dataKeys: ['new'],
  excludeAdminEvents: true
})

module.exports = async (req, res) => {
  if (rejected(req)) {
    return res.status(204).json({ message: 'irrelevant trigger' })
  }

  const player = req.body.event.data.new
  
  const data = await gql(`{
    games_by_pk(id: ${player.game_id}) {
      id
      owner_id
      player_count
      is_full
      players {
        id
        user_id
        joined_at
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
  
  let game = data.games_by_pk
  
  const shouldDeletePlayer = game.players.find(p => p.user_id === player.user_id && p.id !== player.id)
  
  if (shouldDeletePlayer) {
    const data = await gql(`mutation {
      delete_players(where: {id: {_eq: ${player.id}}}) {
        returning {
          game {
            id
            owner_id
            player_count
            is_full
            players {
              id
              user_id
              joined_at
            }
            players_aggregate {
              aggregate {
                count
              }
            }
          }
        }
      }
    }`).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
    if (data instanceof Error) {
      return res.status(500).json({ success: false })
    }

    game = data.delete_players.returning[0].game
  }
  
  if (game.players_aggregate.aggregate.count >= game.player_count && !game.is_full) {
    const data = await gql(`mutation {
      update_games(where: {id: {_eq: ${game.id}}}, _set: {is_full: true}) {
        returning {
          id
          owner_id
          player_count
          is_full
          players {
            id
            user_id
            joined_at
          }
          players_aggregate {
            aggregate {
              count
            }
          }
        }
      }
    }`).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
    if (data instanceof Error) {
      return res.status(500).json({ success: false })
    }

    game = data.update_games.returning[0]
  }
  
  if (game.players_aggregate.aggregate.count > game.player_count) {
    const difference = game.players_aggregate.aggregate.count - game.player_count

    const deletePlayers = game.players
      .filter(p => p.user_id !== game.owner_id)
      .sort((a, b) => new Date(a.joined_at).valueOf() - new Date(b.joined_at).valueOf())
      .slice(0, difference)
      .map(p => p.id)
    
    const variables = { deleteIds: deletePlayers }
    
    const data = await gql(`mutation delete_players($deleteIds: [Int]) {
      delete_players(where: {id: {_in: $deleteIds}}) {
        returning {
          game {
            id
            owner_id
            player_count
            is_full
            players {
              id
              user_id
              joined_at
            }
            players_aggregate {
              aggregate {
                count
              }
            }
          }
        }
      }
    }`, variables).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
    if (data instanceof Error) {
      return res.status(500).json({ success: false })
    }

    game = data.delete_players.returning[0].game
  }
  
  if (game.players_aggregate.aggregate.count < game.player_count && game.is_full) {
    const data = await gql(`mutation update_games($gameId: Int) {
      update_games(where: {id: {_eq: $gameId}}, _set: {is_full: false}) {
        returning {
          id
          owner_id
          player_count
          is_full
          players {
            id
            user_id
            joined_at
          }
          players_aggregate {
            aggregate {
              count
            }
          }
        }
      }
    }`, { gameId: game.id }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
    
    if (data instanceof Error) {
      return res.status(500).json({ success: false })
    }
  }

  res.status(200).json({ success: true })
}