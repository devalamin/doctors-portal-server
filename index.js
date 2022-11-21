const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken')
require('dotenv').config();

const stripe = require("stripe")(process.env.STRIPE_SECRET);


const port = process.env.PORT || 5000;


const app = express();

app.use(cors());
app.use(express.json());





const uri = `mongodb+srv://${process.env.DOCTOR_USER}:${process.env.DOCTOR_PASSWORD}@cluster0.3b5klku.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden' })
        }
        req.decoded = decoded;
        next();
    })
}


async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorPortal').collection('servicesOptions');
        const bookingsCollection = client.db('doctorPortal').collection('bookings')
        const usersCollection = client.db('doctorPortal').collection('users')
        const doctorsCollection = client.db('doctorPortal').collection('doctors')


        // note: make sure you use verifyAdmin after verifyjwt

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send('forbidden access')
            };
            next();
        }


        app.get('/appointmentoptions', async (req, res) => {
            const date = req.query.date;
            console.log(date);
            const query = {}
            const options = await appointmentOptionCollection.find(query).toArray();
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatmentName === option.name)

                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;

                console.log(date, option.name, remainingSlots.length);
            })
            res.send(options)
        });


        app.get('/appointmentspecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })


        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send('forbidden')
            }

            const query = { email: email }
            const result = await bookingsCollection.find(query).toArray()
            res.send(result)

        });

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await bookingsCollection.findOne(query);
            res.send(result)
        })

        app.post('/bookings', async (req, res) => {
            const bookings = req.body;
            const query = {
                appointmentDate: bookings.appointmentDate,
                email: bookings.email,
                treatmentName: bookings.treatmentName

            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `you already have an appointment on ${bookings.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }
            console.log(bookings);
            const result = await bookingsCollection.insertOne(bookings)
            res.send(result)
        });

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;


            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                "payment_method_types": [
                    "card"
                ],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            // console.log('email', email);
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            // console.log('User', user);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '5d' })
                return res.send({ accessToken: token })
            }
            console.log(user);
            res.status(403).send({ accessToken: '' })
        });

        app.get('/users', async (req, res) => {
            const query = {}
            const result = await usersCollection.find(query).toArray();
            res.send(result)
        });

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query)
            res.send({ isAdmin: user?.role === 'admin' })
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user)
            res.send(result)

        });

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options)
            res.send(result)


        });

        // app.get('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true };
        //     const updatedDoc = {
        //         $set: {
        //             price: 78
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result)
        // });

        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {}
            const result = await doctorsCollection.find(query).toArray();
            res.send(result)
        })

        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)
        });

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await doctorsCollection.deleteOne(query);
            res.send(result)
        })

    }
    finally {

    }
}

run().catch(console.log())




app.get('/', async (req, res) => {
    res.send('Doctor server is running');
})

app.listen(port, () => console.log('server is running on', port))