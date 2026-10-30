
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const app = express();
app.set('trust proxy', 1);
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const conexion = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    ssl: {
        ca: fs.readFileSync(
            path.join(__dirname, 'certificados', 'isrgrootx1.pem')
        ),
        minVersion: 'TLSv1.2'
    }
});

const pool = {
    query: async (...args) => {
        const [resultado] = await conexion.query(...args);
        return resultado;
    }
};
const PUERTO = process.env.PORT || 3000;


app.use(cors({
    origin: 'https://econaku.pages.dev',
    credentials: true
}));

app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 1000 * 60 * 60 * 2
    }
}));


app.get('/api', (req, res) => {
    res.json({
        mensaje: 'API de Misantla-Dex funcionando'
    });
});

app.get('/api/habitats', async (req, res) => {
    try {
        const habitats = await pool.query(
            'SELECT * FROM habitats'
        );

        res.json(habitats);
    } catch (error) {
        console.error('Error al consultar hábitats:', error.message);
        res.status(500).json({
            error: 'No se pudieron consultar los hábitats'
        });
    }
});


app.get('/api/especies', async (req, res) => {
    try {
        const especies = await pool.query(
            `SELECT
                id_especie,
                codigo,
                nombre,
                nombre_cientifico,
                categoria,
                descripcion,
                imagen_url,
                id_habitat
            FROM especies
            ORDER BY CAST(codigo AS UNSIGNED)`
        );

        res.json(especies);

    } catch (error) {
        console.error('Error al consultar especies:', error.message);

        res.status(500).json({
            error: 'No se pudieron consultar las especies'
        });
    }
});


app.post('/api/registro', async (req, res) => {
    const { nombre_usuario, password } = req.body;

    if (!nombre_usuario || !password) {
        return res.status(400).json({
            error: 'El usuario y la contraseña son obligatorios'
        });
    }

    if (nombre_usuario.trim().length < 3 || password.length < 8) {
        return res.status(400).json({
            error: 'El usuario debe tener al menos 3 caracteres y la contraseña 8'
        });
    }

    try {
        const hash = await bcrypt.hash(password, 12);

        await pool.query(
            'INSERT INTO usuarios (nombre_usuario, password_hash) VALUES (?, ?)',
            [nombre_usuario.trim(), hash]
        );

        res.status(201).json({
            mensaje: 'Usuario registrado correctamente'
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'Ese nombre de usuario ya existe'
            });
        }

        console.error('Error al registrar usuario:', error.message);

        res.status(500).json({
            error: 'No se pudo registrar el usuario'
        });
    }
});

app.post('/api/login', async (req, res) => {
    const { nombre_usuario, password } = req.body;

    if (!nombre_usuario || !password) {
        return res.status(400).json({
            error: 'El usuario y la contraseña son obligatorios'
        });
    }

    try {
        const usuarios = await pool.query(
            'SELECT id_usuario, nombre_usuario, password_hash FROM usuarios WHERE nombre_usuario = ? LIMIT 1',
            [nombre_usuario.trim()]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                error: 'Usuario o contraseña incorrectos'
            });
        }

        const usuario = usuarios[0];
        const coincide = await bcrypt.compare(password, usuario.password_hash);

        if (!coincide) {
            return res.status(401).json({
                error: 'Usuario o contraseña incorrectos'
            });
        }

        req.session.usuario = {
            id_usuario: usuario.id_usuario,
            nombre_usuario: usuario.nombre_usuario
        };

        res.json({
            mensaje: 'Inicio de sesión correcto',
            usuario: req.session.usuario
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error.message);

        res.status(500).json({
            error: 'No se pudo iniciar sesión'
        });
    }
});

app.get('/api/sesion', (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({
            error: 'No hay una sesión iniciada'
        });
    }

    res.json({
        mensaje: 'Sesión activa',
        usuario: req.session.usuario
    });
});


app.post('/api/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                error: 'No se pudo cerrar la sesión'
            });
        }

        res.clearCookie('connect.sid');

        res.json({
            mensaje: 'Sesión cerrada correctamente'
        });
    });
});

app.post('/api/descubrimientos', async (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({
            error: 'Debes iniciar sesión'
        });
    }

    const { id_especie } = req.body;

    if (!Number.isInteger(id_especie) || id_especie <= 0) {
        return res.status(400).json({
            error: 'El identificador de la especie no es válido'
        });
    }

    try {
        const resultado = await pool.query(
            `INSERT IGNORE INTO descubrimientos
                (id_usuario, id_especie)
             SELECT ?, id_especie
             FROM especies
             WHERE id_especie = ?`,
            [req.session.usuario.id_usuario, id_especie]
        );

        if (resultado.affectedRows === 0) {
            const existe = await pool.query(
                'SELECT id_especie FROM especies WHERE id_especie = ?',
                [id_especie]
            );

            if (existe.length === 0) {
                return res.status(404).json({
                    error: 'La especie no existe'
                });
            }

            return res.json({
                mensaje: 'La especie ya estaba descubierta'
            });
        }

        res.status(201).json({
            mensaje: 'Especie descubierta y guardada'
        });

    } catch (error) {
        console.error('Error al guardar descubrimiento:', error.message);

        res.status(500).json({
            error: 'No se pudo guardar el descubrimiento'
        });
    }
});


app.get('/api/descubrimientos', async (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({
            error: 'Debes iniciar sesión'
        });
    }

    try {
        const descubrimientos = await pool.query(
            `SELECT id_especie, fecha_descubrimiento
             FROM descubrimientos
             WHERE id_usuario = ?
             ORDER BY fecha_descubrimiento DESC`,
            [req.session.usuario.id_usuario]
        );

        res.json(descubrimientos);

    } catch (error) {
        console.error('Error al consultar descubrimientos:', error.message);

        res.status(500).json({
            error: 'No se pudieron consultar los descubrimientos'
        });
    }
});

app.listen(PUERTO, () => {
    console.log(`Servidor iniciado en http://localhost:${PUERTO}`);
});
