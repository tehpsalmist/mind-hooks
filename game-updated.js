const { getGameById, validateRequest } = require('./utilities')
const { startRound } = require('./game-engine')

const rejected = validateRequest({
  tableName: 'games',
  operation: 'UPDATE',
  dataKeys: ['new', 'old'],
  excludeAdminEvents: false,
  comparisonFunction: (oldGame, newGame) => (oldGame.in_conflict && newGame.in_conflict) || (oldGame.transitioning_round && newGame.transitioning_round)
})

module.exports = async (req, res) => {
  if (rejected(req)) {
    return res.status(204).json({ message: 'irrelevant trigger' })
  }

  const game = await getGameById(req.body.event.data.new.id)

  if (!game) return res.status(204).json({ message: 'Unable to fetch game' })

  if (game.started && !game.round) {
    const startedGame = await startRound(game).catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

    if (startedGame instanceof Error) {
      console.error('error starting game', startedGame)
      return res.status(500).json({ message: 'Failed to Start Round' })
    }
  }

  return res.status(200).json({ message: 'all operations complete' })
}
