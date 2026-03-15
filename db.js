const { Sequelize } = require('sequelize');

// Seedha link yahan daal diya hai taaki .env ka jhanjhat khatam ho jaye
const sequelize = new Sequelize('postgres://admin:74Hfuryqe2xu6UN@nssmemberdb.c1u4mw8s0xrb.us-east-2.rds.amazonaws.com:5432/NSS_Ratnam_DB', {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    }
});

module.exports = sequelize;