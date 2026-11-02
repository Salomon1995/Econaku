require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const multer = require('multer');

const subirArchivo = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

const app = express();

const origenesPermitidos = [
    'https://econaku.pages.dev',
    'http://localhost:8000',
    'http://localhost:5500'
];

app.use(cors({
    origin: origenesPermitidos,
    credentials: true
}));
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

function soloAdministrador(req, res, next) {
    if (!req.session.usuario || req.session.usuario.rol !== 'admin') {
        return res.status(403).json({
            error: 'No tienes permisos para realizar esta operación'
        });
    }

    next();
}

app.post('/api/admin/subir-imagen', soloAdministrador, subirArchivo.single('imagen'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ninguna imagen' });
        }

        const resultado = await new Promise((resolve, reject) => {
            const flujo = cloudinary.uploader.upload_stream(
                { folder: 'econaku/especies', resource_type: 'image' },
                (error, resultado) => {
                    if (error) reject(error);
                    else resolve(resultado);
                }
            );

            flujo.end(req.file.buffer);
        });

        res.json({ secure_url: resultado.secure_url });

    } catch (error) {
        console.error('Error al subir imagen:', error);
        res.status(500).json({ error: 'No se pudo subir la imagen' });
    }
});

app.get('/api', (req, res) => {
    res.json({
        mensaje: 'API de Misantla-Dex funcionando'
    });
});

app.get('/api/admin/prueba', soloAdministrador, (req, res) => {
    res.json({
        mensaje: 'Acceso autorizado al administrador',
        usuario: req.session.usuario.nombre_usuario
    });
});

app.get('/api/habitats', async (req, res) => {
    try {
        const [habitats] = await conexion.query(
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

app.post('/api/habitats', soloAdministrador, async (req, res) => {
    const { codigo, nombre, descripcion, imagen_fondo } = req.body;

    if (!codigo?.trim() || !nombre?.trim()) {
        return res.status(400).json({
            error: 'El código y el nombre son obligatorios'
        });
    }

    try {
        const resultado = await pool.query(
            `INSERT INTO habitats
                (codigo, nombre, descripcion, imagen_fondo)
             VALUES (?, ?, ?, ?)`,
            [
                codigo.trim().toLowerCase(),
                nombre.trim(),
                descripcion?.trim() || null,
                imagen_fondo?.trim() || null
            ]
        );

        res.status(201).json({
            mensaje: 'Hábitat registrado correctamente',
            id_habitat: resultado.insertId
        });

    } catch (error) {
        console.error('Error al registrar hábitat:', error.message);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'Ese código de hábitat ya existe'
            });
        }

        res.status(500).json({
            error: 'No se pudo registrar el hábitat'
        });
    }
});

app.put('/api/habitats/:id', soloAdministrador, async (req, res) => {
    const id = Number(req.params.id);
    const { codigo, nombre, descripcion, imagen_fondo } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            error: 'El identificador no es válido'
        });
    }

    if (!codigo?.trim() || !nombre?.trim()) {
        return res.status(400).json({
            error: 'El código y el nombre son obligatorios'
        });
    }

    try {
        const resultado = await pool.query(
            `UPDATE habitats
             SET codigo = ?,
                 nombre = ?,
                 descripcion = ?,
                 imagen_fondo = ?
             WHERE id_habitat = ?`,
            [
                codigo.trim().toLowerCase(),
                nombre.trim(),
                descripcion?.trim() || null,
                imagen_fondo?.trim() || null,
                id
            ]
        );

        if (resultado.affectedRows === 0) {
            const existe = await pool.query(
                'SELECT id_habitat FROM habitats WHERE id_habitat = ?',
                [id]
            );

            if (existe.length === 0) {
                return res.status(404).json({
                    error: 'El hábitat no existe'
                });
            }
        }

        res.json({
            mensaje: 'Hábitat actualizado correctamente'
        });

    } catch (error) {
        console.error('Error al modificar hábitat:', error.message);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'Ese código de hábitat ya está registrado'
            });
        }

        res.status(500).json({
            error: 'No se pudo modificar el hábitat'
        });
    }
});

app.delete('/api/habitats/:id', soloAdministrador, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            error: 'El identificador no es válido'
        });
    }

    try {
        const habitats = await pool.query(
            'SELECT id_habitat FROM habitats WHERE id_habitat = ?',
            [id]
        );

        if (habitats.length === 0) {
            return res.status(404).json({
                error: 'El hábitat no existe'
            });
        }

        const relaciones = await pool.query(
            'SELECT id_especie FROM especie_habitat WHERE id_habitat = ? LIMIT 1',
            [id]
        );

        if (relaciones.length > 0) {
            return res.status(409).json({
                error: 'No puedes eliminar este hábitat porque tiene especies asignadas'
            });
        }

        await pool.query(
            'DELETE FROM habitats WHERE id_habitat = ?',
            [id]
        );

        res.json({
            mensaje: 'Hábitat eliminado correctamente'
        });

    } catch (error) {
        console.error('Error al eliminar hábitat:', error.message);

        res.status(500).json({
            error: 'No se pudo eliminar el hábitat'
        });
    }
});

app.get('/api/especies', async (req, res) => {
    try {
        const [especies] = await conexion.query(`
            SELECT
                e.id_especie,
                e.codigo,
                e.nombre,
                e.nombre_cientifico,
                e.categoria,
                e.descripcion,
                e.imagen_url,
                e.rareza,
                eh.id_habitat,
                h.nombre AS habitat
            FROM especies e
            LEFT JOIN especie_habitat eh
                ON e.id_especie = eh.id_especie
            LEFT JOIN habitats h
                ON eh.id_habitat = h.id_habitat
            ORDER BY e.id_especie
        `);

        const especiesAgrupadas = [];

        for (const especie of especies) {
            let existente = especiesAgrupadas.find(
                item => item.id_especie === especie.id_especie
            );

            if (!existente) {
                existente = {
                    id_especie: especie.id_especie,
                    codigo: especie.codigo,
                    nombre: especie.nombre,
                    nombre_cientifico: especie.nombre_cientifico,
                    categoria: especie.categoria,
                    descripcion: especie.descripcion,
                    imagen_url: especie.imagen_url,
                    rareza: especie.rareza,
                    habitats: []
                };

                especiesAgrupadas.push(existente);
            }

            if (especie.id_habitat !== null && especie.id_habitat !== undefined) {
                existente.habitats.push({
                    id_habitat: especie.id_habitat,
                    nombre: especie.habitat
                });
            }
        }

        res.json(especiesAgrupadas);

    } catch (error) {
        console.error('Error al consultar especies:', error);

        res.status(500).json({
            error: 'No se pudieron consultar las especies'
        });
    }
});

app.post('/api/especies', soloAdministrador, async (req, res) => {
    const {
        codigo,
        nombre,
        nombre_cientifico,
        categoria,
        descripcion,
        rareza,
        imagen_url,
        habitatIds
    } = req.body;

    const categoriasValidas = ['flora', 'fauna', 'hongos'];
    const rarezasValidas = [
        'comun',
        'poco_comun',
        'rara',
        'muy_rara'
    ];

    if (!codigo?.trim() || !nombre?.trim()) {
        return res.status(400).json({
            error: 'El código y el nombre son obligatorios'
        });
    }

    if (!categoriasValidas.includes(categoria)) {
        return res.status(400).json({
            error: 'La categoría no es válida'
        });
    }

    if (!rarezasValidas.includes(rareza)) {
        return res.status(400).json({
            error: 'La rareza no es válida'
        });
    }

    if (
        !Array.isArray(habitatIds) ||
        habitatIds.length === 0 ||
        !habitatIds.every(id => Number.isInteger(id) && id > 0)
    ) {
        return res.status(400).json({
            error: 'Debes seleccionar al menos un hábitat válido'
        });
    }

    const habitatsUnicos = [...new Set(habitatIds)];

    if (habitatsUnicos.length !== habitatIds.length) {
        return res.status(400).json({
            error: 'No puedes repetir hábitats'
        });
    }

    let conexionDB;

    try {
        conexionDB = await conexion.getConnection();
        await conexionDB.beginTransaction();

        const [habitats] = await conexionDB.query(
            `SELECT id_habitat
             FROM habitats
             WHERE id_habitat IN (${habitatsUnicos.map(() => '?').join(',')})`,
            habitatsUnicos
        );

        if (habitats.length !== habitatsUnicos.length) {
            await conexionDB.rollback();

            return res.status(400).json({
                error: 'Uno o varios hábitats no existen'
            });
        }

        const [resultado] = await conexionDB.query(
            `INSERT INTO especies
                (codigo, nombre, nombre_cientifico, categoria,
                 descripcion, rareza, imagen_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                codigo.trim(),
                nombre.trim(),
                nombre_cientifico?.trim() || null,
                categoria,
                descripcion?.trim() || null,
                rareza,
                imagen_url?.trim() || null
            ]
        );

        const idEspecie = resultado.insertId;

        for (const idHabitat of habitatsUnicos) {
            await conexionDB.query(
                `INSERT INTO especie_habitat
                    (id_especie, id_habitat)
                 VALUES (?, ?)`,
                [idEspecie, idHabitat]
            );
        }

        await conexionDB.commit();

        res.status(201).json({
            mensaje: 'Especie registrada correctamente',
            id_especie: idEspecie
        });

    } catch (error) {
        if (conexionDB) {
            await conexionDB.rollback();
        }

        console.error('Error al registrar especie:', error.message);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'El código de la especie ya existe'
            });
        }

        res.status(500).json({
            error: 'No se pudo registrar la especie'
        });

    } finally {
        if (conexionDB) {
            conexionDB.release();
        }
    }
});

app.put('/api/especies/:id', soloAdministrador, async (req, res) => {
    const idEspecie = Number(req.params.id);

    const {
        codigo,
        nombre,
        nombre_cientifico,
        categoria,
        descripcion,
        rareza,
        imagen_url,
        habitatIds
    } = req.body;

    const categoriasValidas = ['flora', 'fauna', 'hongos'];
    const rarezasValidas = ['comun', 'poco_comun', 'rara', 'muy_rara'];

    if (!Number.isInteger(idEspecie) || idEspecie <= 0) {
        return res.status(400).json({
            error: 'El identificador de la especie no es válido'
        });
    }

    if (!codigo?.trim() || !nombre?.trim()) {
        return res.status(400).json({
            error: 'El código y el nombre son obligatorios'
        });
    }

    if (!categoriasValidas.includes(categoria)) {
        return res.status(400).json({
            error: 'La categoría no es válida'
        });
    }

    if (!rarezasValidas.includes(rareza)) {
        return res.status(400).json({
            error: 'La rareza no es válida'
        });
    }

    if (
        !Array.isArray(habitatIds) ||
        habitatIds.length === 0 ||
        !habitatIds.every(id => Number.isInteger(id) && id > 0)
    ) {
        return res.status(400).json({
            error: 'Debes seleccionar al menos un hábitat válido'
        });
    }

    const habitatsUnicos = [...new Set(habitatIds)];

    if (habitatsUnicos.length !== habitatIds.length) {
        return res.status(400).json({
            error: 'No puedes repetir hábitats'
        });
    }

    let conexionDB;

    try {
        conexionDB = await conexion.getConnection();
        await conexionDB.beginTransaction();

        const [especies] = await conexionDB.query(
            'SELECT id_especie FROM especies WHERE id_especie = ?',
            [idEspecie]
        );

        if (especies.length === 0) {
            await conexionDB.rollback();

            return res.status(404).json({
                error: 'La especie no existe'
            });
        }

        const [habitats] = await conexionDB.query(
            `SELECT id_habitat
             FROM habitats
             WHERE id_habitat IN (${habitatsUnicos.map(() => '?').join(',')})`,
            habitatsUnicos
        );

        if (habitats.length !== habitatsUnicos.length) {
            await conexionDB.rollback();

            return res.status(400).json({
                error: 'Uno o varios hábitats no existen'
            });
        }

        await conexionDB.query(
            `UPDATE especies
             SET codigo = ?,
                 nombre = ?,
                 nombre_cientifico = ?,
                 categoria = ?,
                 descripcion = ?,
                 rareza = ?,
                 imagen_url = ?
             WHERE id_especie = ?`,
            [
                codigo.trim(),
                nombre.trim(),
                nombre_cientifico?.trim() || null,
                categoria,
                descripcion?.trim() || null,
                rareza,
                imagen_url?.trim() || null,
                idEspecie
            ]
        );

        await conexionDB.query(
            'DELETE FROM especie_habitat WHERE id_especie = ?',
            [idEspecie]
        );

        for (const idHabitat of habitatsUnicos) {
            await conexionDB.query(
                `INSERT INTO especie_habitat
                    (id_especie, id_habitat)
                 VALUES (?, ?)`,
                [idEspecie, idHabitat]
            );
        }

        await conexionDB.commit();

        res.json({
            mensaje: 'Especie actualizada correctamente',
            id_especie: idEspecie
        });

    } catch (error) {
        if (conexionDB) {
            await conexionDB.rollback();
        }

        console.error('Error al actualizar especie:', error.message);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'El código de la especie ya existe'
            });
        }

        res.status(500).json({
            error: 'No se pudo actualizar la especie'
        });

    } finally {
        if (conexionDB) {
            conexionDB.release();
        }
    }
});

app.delete('/api/especies/:id', soloAdministrador, async (req, res) => {
    const idEspecie = Number(req.params.id);

    if (!Number.isInteger(idEspecie) || idEspecie <= 0) {
        return res.status(400).json({
            error: 'El identificador de la especie no es válido'
        });
    }

    let conexionDB;

    try {
        conexionDB = await conexion.getConnection();
        await conexionDB.beginTransaction();

        const [especies] = await conexionDB.query(
            'SELECT id_especie FROM especies WHERE id_especie = ?',
            [idEspecie]
        );

        if (especies.length === 0) {
            await conexionDB.rollback();

            return res.status(404).json({
                error: 'La especie no existe'
            });
        }

        await conexionDB.query(
            'DELETE FROM descubrimientos WHERE id_especie = ?',
            [idEspecie]
        );

        await conexionDB.query(
            'DELETE FROM especie_habitat WHERE id_especie = ?',
            [idEspecie]
        );

        await conexionDB.query(
            'DELETE FROM especies WHERE id_especie = ?',
            [idEspecie]
        );

        await conexionDB.commit();

        res.json({
            mensaje: 'Especie eliminada correctamente',
            id_especie: idEspecie
        });

    } catch (error) {
        if (conexionDB) {
            await conexionDB.rollback();
        }

        console.error('Error al eliminar especie:', error.message);

        res.status(500).json({
            error: 'No se pudo eliminar la especie'
        });

    } finally {
        if (conexionDB) {
            conexionDB.release();
        }
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

app.post('/api/admin/usuarios', soloAdministrador, async (req, res) => {
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
            `INSERT INTO usuarios
                (nombre_usuario, password_hash, rol)
             VALUES (?, ?, 'admin')`,
            [nombre_usuario.trim(), hash]
        );

        res.status(201).json({
            mensaje: 'Administrador creado correctamente'
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'Ese nombre de usuario ya existe'
            });
        }

        console.error('Error al crear administrador:', error.message);

        res.status(500).json({
            error: 'No se pudo crear el administrador'
        });
    }
});

app.get('/api/admin/usuarios', soloAdministrador, async (req, res) => {
    try {
        const administradores = await pool.query(
            `SELECT id_usuario, nombre_usuario, rol
             FROM usuarios
             WHERE rol = 'admin'
             ORDER BY id_usuario`
        );

        res.json(administradores);

    } catch (error) {
        console.error('Error al consultar administradores:', error.message);

        res.status(500).json({
            error: 'No se pudieron consultar los administradores'
        });
    }
});

app.put('/api/admin/usuarios/:id/password', soloAdministrador, async (req, res) => {
    const id = Number(req.params.id);
    const { password } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            error: 'El identificador no es válido'
        });
    }

    if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({
            error: 'La contraseña debe tener al menos 8 caracteres'
        });
    }

    try {
        const hash = await bcrypt.hash(password, 12);

        const resultado = await pool.query(
            `UPDATE usuarios
             SET password_hash = ?
             WHERE id_usuario = ? AND rol = 'admin'`,
            [hash, id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                error: 'El administrador no existe'
            });
        }

        res.json({
            mensaje: 'Contraseña actualizada correctamente'
        });

    } catch (error) {
        console.error('Error al modificar contraseña:', error.message);

        res.status(500).json({
            error: 'No se pudo modificar la contraseña'
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
            'SELECT id_usuario, nombre_usuario, password_hash, rol FROM usuarios WHERE nombre_usuario = ? LIMIT 1',
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

        req.session.regenerate((error) => {
            if (error) {
               return res.status(500).json({
                    error: 'No se pudo iniciar la sesión'
               });
            }

        req.session.usuario = {
           id_usuario: usuario.id_usuario,
           nombre_usuario: usuario.nombre_usuario,
           rol: usuario.rol
        };

        res.json({
           mensaje: 'Inicio de sesión correcto',
           usuario: req.session.usuario
        });
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

    res.clearCookie('connect.sid', {
           httpOnly: true,
           secure: true,
           sameSite: 'none'
    });

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
