const fetch = require('node-fetch')
const { X_HASURA_ADMIN_SECRET } = process.env

module.exports = async (req, res) => {
  const sql = `DELETE from hdb_catalog.event_invocation_logs; DELETE from hdb_catalog.event_log`
  
  const response = await fetch('https://the-mind.herokuapp.com/v1/query', {
    method: 'POST',
    headers: {
      'X-Hasura-Admin-Secret': X_HASURA_ADMIN_SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: "run_sql",
      args: { sql }
    })
  })
    .then(r => r.json())
    .catch(err => err instanceof Error ? err : new Error(JSON.stringify(err)))

  if (response instanceof Error) {
    return res.status(500).json({ error: response.message })
  }
  
  res.status(200).json({ response })
}