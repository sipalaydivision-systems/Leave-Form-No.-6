const bcrypt = require('bcrypt');

bcrypt.hash('Uq8tj744lHZH', 12, (err, hash) => {
  if (err) {
    console.error('Error:', err);
    process.exit(1);
  }
  console.log(hash);
});
