require('dotenv').config();

const mysql = require('mysql2/promise');

async function probarConexion() {
    let conexion;

    try {
        conexion = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: {
               minVersion: 'TLSv1.2'
            }
        });

        console.log('¡Conexión a TiDB Cloud exitosa!');

        const resultado = await conexion.query('SHOW TABLES');
        console.log(resultado);

    } catch (error) {
        console.error('Error de conexión:', error.message);

    } finally {
        if (conexion) {
            await conexion.end();
        }
    }
}

probarConexion();
