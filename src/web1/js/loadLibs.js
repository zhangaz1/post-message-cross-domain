function loadLibs() {
	var libs = [];

	if (typeof Penpal === 'undefined') {
		libs.push(JavaScript.load('http://localhost:8080/js/penpal.js'));
	}

	return Promise.all(libs);
}