const { getGameById, validateRequest, sleep } = require('./utilities')
const {
  isGameConflicted,
  setGameInConflict,
  conflictResolution,
  startRound,
  dealOutRewards,
  setGameInTransition,
  resolveConflict,
  concludeGame
} = require('./game-engine')

const rejected = validateRequest({
  tableName: 'plays',
  operation: 'INSERT',
  dataKeys: ['new'],
  excludeAdminEvents: true
})

module.exports = async (req, res) => {
  if (rejected(req)) {
    return res.status(204).json({ message: 'irrelevant trigger' })
  }

  const freshPlay = req.body.event.data.new
  
  let game = await getGameById(freshPlay.game_id)

  if (!game) return res.status(204).json({ message: 'Error finding game' })

  if (game.ready && !game.in_conflict && !game.round.is_blind && isGameConflicted(game)) {
    game = await setGameInConflict(game)

    if (!game) {
      return res.status(500).json({ message: 'error setting game to conflicted' })
    }
    
    await sleep(1000)

    game = await resolveConflict(game)

    if (!game) {
      return res.status(500).json({ message: 'error resolving conflict' })
    }

    if (!game.lives || game.lives < 1) {
      const gameConcluded = await concludeGame(game)

      if (!gameConcluded) {
        return res.status(500).json({ message: 'Failed to Conclude Game' })
      }

      return res.status(200).json({ message: `Game ${game.id} Concluded` })    }

    await sleep(3000)
  }

  if (!game.finished && !game.in_conflict && !game.transitioning_round && game.players.every(player => !player.cards.length)) {
    if (game.round.is_blind && isGameConflicted(game)) {
      game = await setGameInConflict(game)

      if (!game) {
        return res.status(500).json({ message: 'error setting game to conflicted' })
      }
      
      await sleep(1000)

      game = await resolveConflict(game)

      if (!game) {
        return res.status(500).json({ message: 'error resolving conflict' })
      }

      if (!game.lives || game.lives < 1) {
        const gameConcluded = await concludeGame(game)

        if (!gameConcluded) {
          return res.status(500).json({ message: 'Failed to Conclude Game' })
        }

        return res.status(200).json({ message: `Game ${game.id} Concluded` })
      }

      await sleep(3000)
    }

    const [transitioningGame, nextRound] = await setGameInTransition(game)

    if (!transitioningGame) {
      return res.status(500).json({ message: 'Error transitioning game' })
    }

    await sleep(1000)

    await dealOutRewards(transitioningGame)

    await sleep(1000)

    await startRound(transitioningGame, nextRound)
  }

  res.status(200).json({ success: true })
}