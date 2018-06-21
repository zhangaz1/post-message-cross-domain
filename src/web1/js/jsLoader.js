var JavaScript = {
	load: function(src) {
		return new Promise(function(resolve, reject) {
			var script = document.createElement('script');

			var loaded = false;

			// script.setAttribute('src', src);
			script.type = 'text/javascript';
			script.src = src;

			script.onreadystatechange = script.onload = function() {
				if (!loaded) {
					resolve();
				}
				loaded = true;
			};

			document.getElementsByTagName('head')[0].appendChild(script);
		});
	}
};