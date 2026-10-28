APP_ID := io.github.averagenative.livestudiolinux
VERSION = $(shell node -p "require('./package.json').version")

.PHONY: check test lint run appimage install uninstall hooks

check: lint test

lint:
	@for f in src/*.js src/renderer/*.js test/*.js; do node --check $$f || exit 1; done

test:
	node --test test/*.test.js

run:
	npx electron .

appimage: check
	npx electron-builder --linux AppImage

install:
	./install-desktop.sh

uninstall:
	rm -f $(HOME)/.local/share/applications/$(APP_ID).desktop \
	      $(HOME)/.local/share/icons/hicolor/512x512/apps/$(APP_ID).png \
	      $(HOME)/Applications/live-studio-linux-x86_64.AppImage

hooks:
	git config core.hooksPath .githooks
