const express = require('express')
const bodyParser = require('body-parser')

const app = express()

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.post('/player-joins', require('./player-joins'))
app.post('/player-leaves', require('./player-leaves'))
app.post('/card-played', require('./card-played'))
app.post('/game-updated', require('./game-updated'))
app.post('/player-updated', require('./player-updated'))
app.get('/new-user/:userId', require('./new-user'))
app.post('/message-sent', require('./message-sent'))
app.get('/clear-db', require('./clear-db'))

const listener = app.listen(process.env.PORT, () => {
  console.log('The Mind is live on port ' + listener.address().port)
})

const runTests = require('./test')
