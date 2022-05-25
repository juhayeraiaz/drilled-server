const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken')
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const res = require('express/lib/response');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.68ftj.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


// verifying JWT token for security

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

async function run() {
    try {

        // all the connections to mongoDB

        await client.connect();
        const userCollection = client.db('drilled_tools').collection('users');
        const itemsCollection = client.db('drilled_tools').collection('items');
        const purchasedCollection = client.db('drilled_tools').collection('purchased');
        const paymentCollection = client.db('drilled_tools').collection('payments');
        const reviewCollection = client.db('drilled_tools').collection('reviews');



        // basic user info taken upon signup or signin
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updatedDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updatedDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '20d' })
            res.send({ result, token });
        })

        // verifying admin 
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        }


        //  payment method intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });


        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })
        //  updating my profile section
        app.post('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const updatedUser = req.body;
            const options = { upsert: true };
            const updatedDoc = {
                $set: updatedUser,
            }
            const result = await userCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })
        // filtering a user by email 
        app.get('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const user = await userCollection.findOne(filter);
            res.send(user);
        })

        // filtering an admin by admin role 
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })
        // making a user admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        })

        // deleting a user
        app.delete('/user/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await userCollection.deleteOne(filter);
            res.send(result);
        })


        // getting all reviews
        app.post('/reviews', verifyJWT, async (req, res) => {
            const reviews = req.body;
            const getReviews = await reviewCollection.insertOne(reviews);
            res.send(getReviews);
        })
        app.get('/reviews', async (req, res) => {
            const reviews = await reviewCollection.find().toArray();
            res.send(reviews);
        })

        // getting all items

        app.get('/items', async (req, res) => {
            const query = {};
            const cursor = itemsCollection.find(query);
            const items = await cursor.toArray();
            res.send(items);
        });
        // getting item by unique id
        app.get('/items/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const item = await itemsCollection.findOne(query);
            res.send(item);
        });

        // adding a item to items collection
        app.post('/items', verifyJWT, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await itemsCollection.insertOne(item);
            res.send(result);
        });

        // updating items quantity
        app.put('/items/:id', async (req, res) => {
            const id = req.params.id;
            const updatedItems = req.body;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    quantity: updatedItems.quantity
                }
            };
            const result = await itemsCollection.updateOne(filter, updatedDoc, options);
            res.send(result);

        })


        // deleting a item by unique id
        app.delete('/items/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await itemsCollection.deleteOne(query);
            res.send(result);
        });

        // getting all purchase information
        app.get('/purchases', verifyJWT, async (req, res) => {
            const purchase = await purchasedCollection.find().toArray();
            res.send(purchase);
        })

        // getting all items purchased info
        app.get('/purchased', verifyJWT, async (req, res) => {
            const buyer = req.query.buyer;
            const decodedEmail = req.decoded.email;
            if (buyer === decodedEmail) {
                const query = { buyer: buyer };
                const purchased = await purchasedCollection.find(query).toArray();
                return res.send(purchased);
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }
        })
        // getting a purchased item info 
        app.get('/purchased/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const purchase = await purchasedCollection.findOne(query);
            res.send(purchase);
        })
        // deleting a purchased item
        app.delete('/purchased/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await purchasedCollection.deleteOne(filter);
            res.send(result);
        })

        // inserting a item info on purchase
        app.post('/purchased', verifyJWT, async (req, res) => {
            const purchased = req.body;
            const result = await purchasedCollection.insertOne(purchased);
            res.send(result)
        })
        // updating item status upon payment
        app.patch('/purchased/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    delivery: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedPurchase = await purchasedCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc)
        })
        // updating delivery status
        app.post('/purchased/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatePurchase = req.body;
            const updatedDoc = {
                $set: updatePurchase
            }
            const result = await purchasedCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })

    }
    finally {

    }
}


run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello From Drilled Tools')
})

app.listen(port, () => {
    console.log(`Drilled App listening on port ${port}`)
})