const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const admin = require('firebase-admin');
const cors = require('cors');

process.stdout.write("Direct output to stdout\n");
console.log("Starting the app!");
console.log(process.env.ON_HEROKU);

if (process.env.ON_HEROKU === "True"){ 
  console.log("On Heroku"); 

  const serviceAccountJson = {
    type: "service_account",
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'), // Ensure correct formatting
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
    universe_domain: process.env.UNIVERSE_DOMAIN
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountJson),
  });
}
else{
  const serviceAccount = require('./firebase-admin.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

app.use(bodyParser.json());
app.use(cors());

// Middleware to verify Firebase token
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split(' ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Attach user information to request object
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
};

// Endpoint to create a user or update their role if they don't exist
app.post('/api/create', verifyFirebaseToken, async (req, res) => {
  const userDocRef = db.collection('users').doc(req.user.uid);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    const userData = {
      email: req.user.email || 'undefined_email',
      role: req.body.role || 'submitter',
      history: [],
    };

    await userDocRef.set(userData);
    res.json({ Status: 'User created' });
  } else {
    res.json({ Status: 'User already exists' });
  }
});

// Endpoint to create an event
app.post('/api/events', verifyFirebaseToken, async (req, res) => {
  const { title, description } = req.body;

  if (!title || !description) {
    return res.status(400).json({ message: 'Title and description are required.' });
  }

  try {
    const eventData = {
      title,
      description,
      userId: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('events').add(eventData);
    res.status(201).json({ message: 'Event created successfully!' });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint to fetch user-specific events
app.get('/api/events', verifyFirebaseToken, async (req, res) => {
  try {
    const userEventsRef = db.collection('events').where('userId', '==', req.user.uid).orderBy('createdAt', 'desc');
    const snapshot = await userEventsRef.get();

    const events = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// New endpoint to add event to user's history
app.post('/api/attend-event', verifyFirebaseToken, async (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return res.status(400).json({ message: 'Event ID is required.' });
  }

  try {
    const userRef = db.collection('users').doc(req.user.uid); // Reference to the user's document
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Update the user's history field with the event ID
    await userRef.update({
      history: admin.firestore.FieldValue.arrayUnion(eventId), // Add the event ID to the history array
    });

    res.status(200).json({ message: 'Event added to user history.' });
  } catch (error) {
    console.error('Error attending event:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
app.get('/', (req, res) => {
  res.send('Welcome to the backend API!');
});

// New endpoint to search events by title
app.get('/api/search-events', verifyFirebaseToken, async (req, res) => {
  const { query } = req.query; // Get the search query from the request

  if (!query || query.trim() === '') {
    return res.status(400).json({ message: 'Query parameter is required.' });
  }

  try {
    // Search for events whose title starts with the query string (case-insensitive)
    const eventsRef = db.collection('events');
    const snapshot = await eventsRef
      .where('title', '>=', query)   // Match titles starting with query
      .where('title', '<=', query + '\uf8ff') // Match titles within a range
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: 'No events found for this search.' });
    }

    // Map the documents into an array of event data
    const events = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(events); // Send the search results
  } catch (error) {
    console.error('Error searching events:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// New endpoint to remove event from user's history
app.post('/api/unattend-event', verifyFirebaseToken, async (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return res.status(400).json({ message: 'Event ID is required.' });
  }

  try {
    console.log(`Unattending event with ID: ${eventId}`); // Log the eventId for debugging

    const userRef = db.collection('users').doc(req.user.uid); // Reference to the user's document
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Remove the event ID from the user's history array
    await userRef.update({
      history: admin.firestore.FieldValue.arrayRemove(eventId), // Remove the event ID from the history array
    });

    res.status(200).json({ message: 'Event removed from user history.' });
  } catch (error) {
    console.error('Error unattending event:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const port = process.env.PORT ||  3001;


// Start the server
app.listen(port, () => {
  console.log('Server running on http://localhost:' + port);
});
