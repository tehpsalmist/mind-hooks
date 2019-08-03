const { gql } = require('./graphql')
const { validateRequest, getGameById, sleep } = require('./utilities')
const {
  setGameToReady,
  setGameToNotReady,
  revealCards,
  dealOutRewards,
  setGameInTransition,
  startRound
} = require('./game-engine')

const rejected = validateRequest({
  tableName: 'players',
  operation: 'UPDATE',
  dataKeys: ['new', 'old'],
  excludeAdminEvents: true,
  comparisonFunction: (oldPlayer, newPlayer) => oldPlayer.ready === newPlayer.ready && oldPlayer.suggesting_star === newPlayer.suggesting_star
})

module.exports = async (req, res) => {
  if (rejected(req)) {
    return res.status(204).json({ message: 'irrelevant trigger' })
  }

  let game = await getGameById(req.body.event.data.new.game_id)

  if (!game) return res.status(204).json({ message: 'Unable to fetch game' })

  // All Players Are Ready
  if (!game.finished && !game.ready && !game.in_conflict && game.players.every(player => player.ready)) {
    await setGameToReady(game.id)
  }

  // A Player Declared Concentration
  if (!game.finished && game.ready && !game.in_conflict && game.players.some(player => !player.ready)) {
    await setGameToNotReady(game)
  }

  if (!game.finished && !game.in_conflict && game.stars > 0 && game.players.every(player => player.suggesting_star)) {
    game = await revealCards(game)

    if (!game) return res.status(500).json({ message: 'Error revealing cards' })
  }

  if (!game.finished && !game.transitioning_round && game.players.every(player => !player.cards.length)) {
    const [transitioningGame, nextRound] = await setGameInTransition(game)

    if (!transitioningGame) {
      return res.status(500).json({ message: 'Error transitioning game' })
    }

    await sleep(1000)

    await dealOutRewards(transitioningGame)

    await sleep(1000)

    return startRound(transitioningGame, nextRound)
  }

  res.status(200).json({ success: true })
}