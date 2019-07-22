const { gql } = require('./graphql')

const deck = Array(100).fill(1).map((n, i) => n + i)

const startRound = async (game, round = { number_of_cards: 1, id: 1 }) => {
  shuffleAndDeal(game.players, round.number_of_cards)

  const variables = game.players.reduce((vars, { id, cards }) => ({
    ...vars,
    [`player${id}Id`]: id,
    [`player${id}`]: { ready: false, cards: `{${cards.join(',')}}` }
  }), { gameId: game.id, roundId: round.id })

  const startedGame = gql(`
    mutation start_round($gameId: Int, $roundId: Int, ${game.players.map(({ id }) => `$player${id}Id: Int, $player${id}: players_set_input`).join(', ')}) {
      update_games(where: {id: {_eq: $gameId}}, _set: {round_id: $roundId, transitioning_round: false}) {
        affected_rows
      }
      ${game.players.map(({ id }) => `
        player${id}: update_players(where: {id: {_eq: $player${id}Id}}, _set: $player${id}) {
          affected_rows
        }
      `).join('\n')}
    }
  `, variables)
    .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

  if (startedGame instanceof Error) {
    console.error('error starting game:', startedGame.message)
    return null
  }

  return startedGame
}

const setGameToReady = async (gameId) => {
  const readyGame = await gql(`
    mutation {
      update_games(where: {id: {_eq: ${gameId}}}, _set: {in_conflict: false, ready: true}) {
        affected_rows
      }
    }
  `).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
  
  if (readyGame instanceof Error) {
    console.error('error setting game ready state:', readyGame.message)
    return null
  }

  return readyGame
}

const setGameToNotReady = async (game) => {
  const variables = {
    playerIds: game.players.map(({ id }) => id),
    gameId: game.id
  }

  const notReady = await gql(`
    mutation game_not_ready($playerIds: [Int!], $gameId: Int) {
      update_games(where: {id: {_eq: $gameId}}, _set: {ready: false}) {
        affected_rows
      }
      update_players(where: {id: {_in: $playerIds}}, _set: {ready: false}) {
        affected_rows
      }
    }
  `, variables)
    .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

  if (notReady instanceof Error) {
    console.error('error setting game ready state:', notReady.message)
    return null
  }

  return notReady
}

const revealCards = async game => {
  const initialVariables = {
    gameId: game.id,
    newRevelations: game.players
      .map(p => p.cards.length && {
        value: p.cards[0],
        user_id: p.user_id,
        player_id: p.id,
        game_id: game.id,
        round_id: game.round.id
      })
      .filter(Boolean)
  }

  const [query, variables] = buildCardRevealQuery(game.players, initialVariables)

  const result = await gql(query, variables).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
  
  if (
    result instanceof Error||
    !result ||
    !result.update_games ||
    !result.update_games.returning ||
    !result.update_games.returning[0]
  ) {
    console.error(result)
    return null
  }

  return result.update_games.returning[0]
}

const isGameConflicted = game => {
  let lowestUnplayedCard = game.players
    .reduce((lowest, player) => Math.min(lowest, player.cards[0] || 101), 101)

  return game.plays
    .filter(play => play.round_id === game.round.id)
    .some(play => {
      if (play.value < lowestUnplayedCard || play.reconciled) {
        lowestUnplayedCard = play.value

        return false
      }

      return true
    })
}

const setGameInConflict = async game => {
  const variables = {
    gameId: game.id,
    playerIds: game.players.map(({ id }) => id)
  }

  const cData = await gql(`
    mutation conflicted_game($gameId: Int, $playerIds: [Int!]) {
      update_players(where: {id: {_in: $playerIds}}, _set: {ready: false}) {
        affected_rows
      }
      update_games(where: {id: {_eq: $gameId}}, _set: {in_conflict: true, ready: false}) {
        returning {
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
          finished_at
          created_at
          owner_id
        }
      }
    }
  `, variables)
    .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

  if (cData instanceof Error ||
    !cData ||
    !cData.update_games ||
    !cData.update_games.returning ||
    !cData.update_games.returning[0]
  ) {
    await gql(`mutation unconflicted_game($gameId: Int) {
      update_games(where: {id: {_eq: $gameId}}, _set: {in_conflict: false}) {
        affected_rows
      }
    }`, { gameId: game.id })
      .catch(err => console.error('Can\'t even unstick it...', err))

    console.error(cData instanceof Error ? cData.message : `no conflict data: ${cData}`)
    return null
  }

  return cData.update_games.returning[0]
}

const conflictResolution = game => {
  const playsThisRound = game.plays.filter(play => play.round_id === game.round.id)

  const highestPlayedCard = playsThisRound.reduce((highest, play) => Math.max(highest, play.value || 0), 0)

  const recentPlays = playsThisRound
    .map(({ value, reconciled, id }) => ({ value, reconciled, id, played: true }))
    .reverse()

  const missedCards = game.players
    .reduce((list, player) => [
      ...list,
      ...player.cards
        .filter(c => c < highestPlayedCard)
        .map((value) => ({ user_id: player.user_id, player_id: player.id, value }))
    ], [])
    .sort((a, b) => a - b)

  const conflictList = mergeCardLists(recentPlays, missedCards)

  const problemCards = conflictList.reduce((list, play, index, plays) => {
    if (
      !play.played ||
      (
        !play.reconciled &&
        (
          play.value < (plays[index - 1] || { value: 0 }).value ||
          !(plays[index - 1] || { played: true }).played
        )
      )
    ) {
      if (!list[0] || (plays[index - 1].played && !play.played)) {
        list.push({ currentHighest: play.value, unreconciled: [play] })

        return list
      }

      const currentGroup = list[list.length - 1]

      currentGroup.currentHighest = Math.max(currentGroup.currentHighest, play.value)
      currentGroup.unreconciled.push(play)
    }

    return list
  }, [])

  const livesToLose = game.round.is_blind ? -1 : 0 - problemCards.length

  const { newPlays, oldPlayIds } = problemCards
    .map(({ unreconciled }) => unreconciled)
    .reduce((list, group) => [...list, ...group], [])
    .reduce(({ newPlays, oldPlayIds }, play) => {
      if (play.played) {
        oldPlayIds.push(play.id)
      } else {
        newPlays.push({ ...play, reconciled: true, game_id: game.id, round_id: game.round.id })
      }

      return { newPlays, oldPlayIds }
    }, { newPlays: [], oldPlayIds: [] })

  return buildConflictResolutionQuery(game.players, missedCards, { newPlays, oldPlayIds, livesToLose, gameId: game.id })
}

const resolveConflict = async game => {
  const [query, variables] = conflictResolution(game)

  const result = await gql(query, variables)
    .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

  if (result instanceof Error || !result.update_games || !result.update_games.returning|| !result.update_games.returning[0]) {
    console.error('Error resolving conflict: ', result instanceof Error ? result : 'can\'t find object')
    return null
  }

  return result.update_games.returning[0]
}

const setGameInTransition = async game => {
  const variables = {
    gameId: game.id,
    playerIds: game.players.map(({ id }) => id)
  }

  const [tData, nextRound] = await Promise.all([
    gql(`mutation transitioning_round($gameId: Int, $playerIds: [Int!]) {
      update_players(where: {id: {_in: $playerIds}}, _set: {ready: false}) {
        affected_rows
      }
      update_games(where: {id: {_eq: $gameId}}, _set: {transitioning_round: true, ready: false}) {
        returning {
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
          finished_at
          created_at
          owner_id
        }
      }
    }`, variables)
      .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err))),
    gql(`query get_round($roundId: Int!) {
      rounds_by_pk(id: $roundId) {
        id
        reward
        number_of_cards
        is_blind
      }
    }`, { roundId: game.round.id + 1 })
      .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
  ])

  if (tData instanceof Error ||
    !tData ||
    !tData.update_games ||
    !tData.update_games.returning ||
    !tData.update_games.returning[0]
  ) {
    await gql(`mutation untransitioning_round($gameId: Int) {
      update_games(where: {id: {_eq: $gameId}}, _set: {transitioning_round: false}) {
        affected_rows
      }
    }`, { gameId: game.id })
      .catch(err => console.error('Can\'t even unstick it...', err))

    console.error(tData instanceof Error ? tData.message : `no conflict data: ${tData}`)
    return [null]
  }

  return [tData.update_games.returning[0], nextRound.rounds_by_pk]
}

const dealOutRewards = async game => {
  const reward = game.round.reward === 'star' ? 'stars' : game.round.reward === 'life' ? 'lives' : null

  if (reward) {
    const rewarded = await gql(`
      mutation grant_reward($${reward}: Int, $gameId: Int) {
        update_games(where: {id: {_eq: $gameId}}, _set: {${reward}: $${reward}, in_conflict: false}) {
          affected_rows
        }
      }
    `, {
      [reward]: game[reward] + 1
    }).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

    if (rewarded instanceof Error) {
      console.error('error granting rewards:', rewarded.message)
      return null
    }

    return rewarded
  }
}

const concludeGame = async game => {
  const result = await gql(`
    mutation {
      update_games(where: {id: {_eq: ${game.id}}}, _set: {finished: true, finished_at: "${new Date().toISOString()}"}) {
        affected_rows
      }
    }
  `).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))
  
  if (result instanceof Error) {
    console.error('Error concluding game', result)
    return null
  }

  return result
}

module.exports = {
  startRound,
  setGameToReady,
  setGameToNotReady,
  revealCards,
  isGameConflicted,
  setGameInConflict,
  conflictResolution,
  setGameInTransition,
  dealOutRewards,
  resolveConflict,
  concludeGame
}

function shuffleAndDeal (players, round) {
  const newDeck = [...deck]

  while (round-- > 0) {
    players.forEach(player => {
      const [nextCard] = newDeck.splice(Math.floor(Math.random() * newDeck.length), 1)
      player.cards.push(nextCard)
    })
  }

  players.forEach(({ cards }) => cards.sort((a, b) => a - b))
}

function mergeCardLists (staticList, sortedList) {
  const finalList = [...staticList]
  console.log('final list', finalList)

  let staticIndex = 0
  let sortedIndex = 0

  while (sortedIndex < sortedList.length) {
    if (
      (finalList[staticIndex - 1] || { value: 0 }).value < sortedList[sortedIndex].value &&
      (finalList[staticIndex] || { value: 100 }).value > sortedList[sortedIndex].value
    ) {
      finalList.splice(staticIndex, 0, sortedList[sortedIndex])
      sortedIndex++
    }

    staticIndex++
  }

  return finalList
}

function buildConflictResolutionQuery (players, missedCards, existingVars = {}) {
  const playerUpdates = []

  players.forEach(player => {
    if (missedCards.some(card => card.player_id === player.id)) {
      playerUpdates.push({
        varNames: `$player${player.id}Id: Int, $player${player.id}Cards: _int2`,
        query: `
          player${player.id}: update_players(where: {id: {_eq: $player${player.id}Id}}, _set: {cards: $player${player.id}Cards}) {
            affected_rows
          }`,
        variables: {
          [`player${player.id}Id`]: player.id,
          [`player${player.id}Cards`]: `{${player.cards.filter(card => missedCards.every(c => c.value !== card)).join(',')}}`
        }
      })
    }
  })

  return [`
    mutation resolve_conflict($gameId: Int, $livesToLose: Int, $oldPlayIds: [Int!], $newPlays: [plays_insert_input!]!${playerUpdates.length ? ', ' + playerUpdates.map(u => u.varNames).join(', ') : ''}) {
      update_plays(where: {id: {_in: $oldPlayIds}}, _set: {reconciled: true}) {
        affected_rows
      }
      insert_plays(objects: $newPlays) {
        affected_rows
      }
      ${playerUpdates.map(u => u.query).join('\n')}
      update_games(where: {id: {_eq: $gameId}}, _set: {in_conflict: false}, _inc: {lives: $livesToLose}) {
        returning {
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
          finished_at
          created_at
          owner_id
        }
      }
    }
  `, playerUpdates.reduce((vars, updates) => ({
    ...vars,
    ...updates.variables
  }), existingVars)]
}

function buildCardRevealQuery (players, variables) {
  const playerUpdates = []

  players.forEach(player => {
    if (player.cards.length) {
      playerUpdates.push({
        varNames: `$player${player.id}Id: Int, $player${player.id}Cards: _int2`,
        query: `
          player${player.id}: update_players(where: {id: {_eq: $player${player.id}Id}}, _set: {cards: $player${player.id}Cards, suggesting_star: false}) {
            affected_rows
          }`,
        variables: {
          [`player${player.id}Id`]: player.id,
          [`player${player.id}Cards`]: `{${player.cards.slice(1).join(',')}}`
        }
      })
    }
  })

  return [`
    mutation reveal_cards($gameId: Int, $newRevelations: [revealed_cards_insert_input!]!${playerUpdates.length ? ', ' + playerUpdates.map(u => u.varNames).join(', ') : ''}) {
      update_games(where: {id: {_eq: $gameId}}, _inc: {stars: -1}) {
        returning {
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
          finished_at
          created_at
          owner_id
        }
      }
      insert_revealed_cards(objects: $newRevelations) {
        affected_rows
      }
      ${playerUpdates.map(u => u.query).join('\n')}
    }
  `, playerUpdates.reduce((vars, updates) => ({
    ...vars,
    ...updates.variables
  }), variables)]
}
