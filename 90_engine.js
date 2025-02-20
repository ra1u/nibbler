"use strict";

/* SYNCHRONISATION NOTES

We need to know whether the data we're receiving relates to the current position,
or is obsolete.

We have considered two possible systems:

-- Sometimes we send "isready", and ignore all output until receiving "readyok"
-- We expect each "go" command to eventually be followed by a "bestmove" message

Sadly, some engines, including Lc0, send "readyok" at dubious times, meaning we
have to always assume the info could be about the wrong position. Bah! Still,
Leela seems to send "readyok" at roughly the correct time if it is after a
"position" command. But not after a mere "stop" command.

The bestmove tracker should be OK, as long as Leela really does send a
"bestmove" for every "go". assumption holds. Note that "ucinewgame" causes Leela
to halt its analysis without sending "bestmove", so we must always send "stop"
before sending "ucinewgame". I think I saw the bestmove tracker cause a real
desync once, though I wasn't logging at the time. Curses! Anyway, I deleted it.

Last version with the bestmove tracker:
https://github.com/fohristiwhirl/nibbler/tree/c6071782f65ce7cbf69384e0e402af2e6239a3d6

*/

function NewEngine() {

	let eng = Object.create(null);

	eng.exe = null;
	eng.readyok_required = 0;
	eng.scanner = null;
	eng.err_scanner = null;
	eng.ever_sent = false;
	eng.warned = false;

	eng.send = function(msg) {

		if (!this.exe) {
			return;
		}

		if (msg === "isready") {
			this.readyok_required++;
		}

		try {
			msg = msg.trim();
			this.exe.stdin.write(msg);
			this.exe.stdin.write("\n");
			Log("--> " + msg);
			this.ever_sent = true;
		} catch (err) {
			Log("(failed) --> " + msg);
			if (this.ever_sent && !this.warned) {
				this.warned = true;
				alert("The engine appears to have crashed.");
			}
		}
	};

	eng.setoption = function(name, value) {
		this.send(`setoption name ${name} value ${value}`);
	};

	eng.setup = function(receive_fn, err_receive_fn) {

		// This is slightly sketchy, the passed functions get saved to our engine
		// object in a way that makes them look like methods of this object. Hmm.
		//
		// Also note, everything is stored as a reference in the object. Not sure
		// if this is needed to stop stuff getting garbage collected...?

		this.receive_fn = receive_fn;
		this.err_receive_fn = err_receive_fn;

		// Precautionary / defensive coding, in case these somehow got changed
		// before setup() is called (impossible at time of writing)...

		this.readyok_required = 0;

		try {
			this.exe = child_process.spawn(config.path, config.args, {cwd: path.dirname(config.path)});
		} catch (err) {
			alert(err);
			return;
		}
		
		this.exe.once("error", (err) => {
			alert(err);
		});

		this.scanner = readline.createInterface({
			input: this.exe.stdout,
			output: undefined,
			terminal: false
		});

		this.err_scanner = readline.createInterface({
			input: this.exe.stderr,
			output: undefined,
			terminal: false
		});

		this.err_scanner.on("line", (line) => {
			Log("! " + line);
			this.err_receive_fn(line);
		});

		this.scanner.on("line", (line) => {

			// We want to ignore all output when waiting for "readyok"

			if (line.includes("readyok") && this.readyok_required > 0) {
				this.readyok_required--;
			}

			if (this.readyok_required > 0) {
				if (config.log_info_lines || line.includes("info") === false) {
					Log("(readyok desync) < " + line);
				}
				return;
			}

			if (config.log_info_lines || line.includes("info") === false) {
				Log("< " + line);
			}

			this.receive_fn(line);
		});
	};

	eng.shutdown = function() {				// Note: Don't reuse the engine object.
		this.receive_fn = () => {};
		this.err_receive_fn = () => {};
		this.send("quit");
	};
	
	return eng;
}
