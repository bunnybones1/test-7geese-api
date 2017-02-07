require('dotenv').config();
var skyBiometry = require('skyBiometry');
var request = require('request');
var express = require('express');
var clientSessions = require('client-sessions');
var http = require('http');
var https = require('https');
var fs = require('fs');
var bodyParser = require('body-parser');
var exphbs  = require('express-handlebars');
var stringify = JSON.stringify;
var mongoose = require('mongoose');
var transformAndCacheFaceImage = require('imageUtils/transformAndCacheFaceImage');

var env = process.env;
var client_id = env.SEVEN_GEESE_CLIENT_ID;
var client_secret = env.SEVEN_GEESE_CLIENT_SECRET;
var tokenUrl = 'https://{client_id}:{client_secret}@app.7geese.com/o/token/'
tokenUrl = tokenUrl.replace('{client_id}', client_id);
tokenUrl = tokenUrl.replace('{client_secret}', client_secret);
var data7GeeseLogin = {
	uri: tokenUrl,
	method: 'POST',
	cors: true,
	headers: {
		"Access-Control-Allow-Origin": "*",
		"Content-Type": "application/x-www-form-urlencoded"
	},
	form: {
		method: 'post',
		grant_type: 'password',
		username: env.SEVEN_GEESE_USER_NAME,
		password: env.SEVEN_GEESE_USER_PASSWORD,
		scope: 'all',
	}
};

var credentials = {
	key: fs.readFileSync('client-key.pem'),
	cert: fs.readFileSync('client-cert.pem')
};

var app = express();

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');

app.use(clientSessions({
	secret: env.CLIENT_SESSIONS_SECRET // CHANGE THIS!
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var httpServer = http.createServer(app);
var httpsServer = https.createServer(credentials, app);
httpServer.listen(8000, function() {
	var address = httpServer.address();
	var host = address.address;
	var port = address.port;
	console.log("listening at http://%s:%s", host, port);
});

httpsServer.listen(8001, function() {
	var address = httpsServer.address();
	var host = address.address;
	var port = address.port;
	console.log("listening at https://%s:%s", host, port);
});

var faceCache = {};
app.use(express.static('public'));

app.get('/', function (req, res){
	if (req.session_state.username) {
		request({
			uri: 'https://app.7geese.com/api/v/2.0/users/?limit=200&offset=0',
			method: 'GET',
			cors: true,
			headers: {
				'Authorization' : 'Bearer ' + req.session_state.access_token
			}
		}, function(err, apiRes, apiBody) {
			if(err) {
				throw new Error(err);
			}
			var users = JSON.parse(apiBody).results;
			var waitingFor = 0;
			var loaded = 0;
			function decrementAndCheckIfDone() {
				loaded++;
				console.log((100*(loaded/waitingFor)).toFixed(1) + '%');
				if(loaded === waitingFor) {
					res.render('home', {
						username: req.session_state.username,
						users: users.filter(function(user) {
							return user.activated;
						}),
						faceTest: users[0].faceData
					});
				}
			}

			function attachFaceData(user, callback) {
				var imgUrl = user.profile_img;
				console.log('get face data for ' + imgUrl);
				function onFindFaceData(err, searchResults) {
					if (err) {
						console.error(err);
					} else if(searchResults.length === 0) {
						console.log('new face', imgUrl);
						waitingFor++;
						skyBiometry.detectFace(imgUrl, function(err, response) {
							if(err) {
								console.log(err);
							}
							var dataString = response.body;
							user.faceData = dataString;
							console.log(dataString);
							decrementAndCheckIfDone();
							callback();
							// Create a FaceData in memory
							var faceData = new FaceData({image_url: imgUrl, data: dataString});
							// Save it to database
							faceData.save(function(err){
								if(err) {
									console.log(err);
								} else {
									console.log('saved to DB: ' + imgUrl);
								}
							});
						});
					} else {
						user.faceData = searchResults[0].data;
						console.log('cached face', imgUrl);
						callback();
					}
					decrementAndCheckIfDone();
				}
				waitingFor++;
				FaceData.find({ image_url: imgUrl }, onFindFaceData);
			}

			for (var i = 0; i < users.length; i++) {
				waitingFor++;
				request({
					uri: 'https://app.7geese.com/api/v/2.0/userprofiles/?user=' + users[i].id,
					method: 'GET',
					cors: true,
					headers: {
						'Authorization' : 'Bearer ' + req.session_state.access_token
					}
				}, function(i2, err2, apiRes2, apiBody2) {
					var user = users[i2];
					user.activated = JSON.parse(apiBody2).results[0].activated;
					user.profile_img = JSON.parse(apiBody2).results[0].profile_img;
					attachFaceData(user, function() {
						var photo = JSON.parse(user.faceData).photos[0];
						var tag = photo && photo.tags[0];
						var points = tag && tag.points;
						if(points) {
							for (var i = 0; i < points.length; i++) {
								points[i].x *= photo.width * 0.01;
								points[i].y *= photo.height * 0.01;
							}
						}
						var faceParams = {
							width: photo.width,
							height: photo.height,
							points: points
						};
						transformAndCacheFaceImage(user.profile_img, faceParams, function(err, localImgPath) {
							if(err) {
								throw new Error(err);
							}
							user.face_img = localImgPath.replace('./public/', '');
							console.log('local file: ' + localImgPath);
							decrementAndCheckIfDone();
						});
					});
				}.bind(null, i));
			}
		})
	} else {
		res.redirect('/login');
	}
});

app.get('/login', function (req, res){
	var data = {};
	if(req.session_state.loginFailed) {
		data.message = 'Invalid username and/or password.';
		delete req.session_state.loginFailed;
	}
	res.render('login', data);
});

app.post('/login', function (req, res){

	data7GeeseLogin.form.username = req.body.uname;
	data7GeeseLogin.form.password = req.body.psw;
	console.log(req.body.uname + ' logging in.');

	request(data7GeeseLogin, function(err, apiRes, apiBody) {
		if(err) {
			console.error(err);
			res.writeHead(501);
			res.end(err);
			return;
		}
		apiBody = JSON.parse(apiBody);

		if(apiBody.access_token) {
			req.session_state.username = req.body.uname;
			req.session_state.access_token = apiBody.access_token;
			console.log(req.body.uname + ' logged in.');
			res.redirect('/');
			return;
		} else {
			req.session_state.loginFailed = true;
			console.log(req.body.uname + ' login failed to authenticate.');
			res.redirect('/');
		}
	});
});

app.get('/logout', function (req, res) {
	req.session_state.reset();
	res.redirect('/');
});

var FaceData;
setTimeout(connectToMongo, 2000);
function connectToMongo() {
	console.log('connect to mongodb!');
	mongoose.connect('mongodb://localhost/faceDataTest');
	var FaceDataSchema = new mongoose.Schema({
		image_url: String,
		data: String
	});
	// Create a model based on the schema
	FaceData = mongoose.model('FaceData', FaceDataSchema);
}

/*
function (req, res) {
	console.log('proxying request');
	var path = req.url;
	console.log(path);


}
*/