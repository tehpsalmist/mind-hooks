const { gql } = require('./graphql')

const validateRequest = ({ tableName, operation, dataKeys, excludeAdminEvents, comparisonFunction }) => req => {
  const { table = {}, event = {} } = req.body

  if (
    table.name !== tableName ||
    event.op !== operation ||
    !event.data ||
    (Array.isArray(dataKeys) && dataKeys.some(key => !event.data[key]))
  ) {
    return true
  }

  if (excludeAdminEvents && event.session_variables && event.session_variables['x-hasura-role'] === 'admin') {
    return true
  }

  if (typeof comparisonFunction === 'function' && comparisonFunction(event.data.old, event.data.new)) {
    return true
  }

  return false
}

const getGameById = async id => {
  const data = await gql(`{
    games_by_pk(id: ${id}) {
      id
      name
      is_full
      lives
      stars
      started
      ready
      in_conflict
      transitioning_round
      finished
      player_count
      players {
        id
        name
        user_id
        suggesting_star
        cards
        ready
      }
      round {
        id
        number_of_cards
        is_blind
        reward
      }
      plays(order_by: {timestamp: desc, round_id: desc}) {
        id
        player_id
        reconciled
        round_id
        timestamp
        value
      }
      revealed_cards(order_by: {timestamp: desc, round_id: desc}) {
        id
        player_id
        round_id
        timestamp
        value
      }
      finished_at
      created_at
      owner_id
    }
  }`).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

  if (!data || !data.games_by_pk || data instanceof Error) {
    return null
  }

  return data.games_by_pk
}

const sleep = ms => new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve()
  }, ms);
})

module.exports = {
  validateRequest,
  getGameById,
  sleep
}
