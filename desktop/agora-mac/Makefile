# Agora macOS Desktop Client - Makefile
# Requires: macOS 13+ and Swift 5.9+

APP_NAME = AgoraMac
BUILD_DIR = .build
RELEASE_DIR = $(BUILD_DIR)/release
DEBUG_DIR = $(BUILD_DIR)/debug
BUNDLE_NAME = Agora.app
BUNDLE_DIR = $(BUILD_DIR)/$(BUNDLE_NAME)

.PHONY: all build release clean run bundle

all: build

# Debug build
build:
	swift build

# Release build
release:
	swift build -c release

# Run in debug mode
run: build
	$(DEBUG_DIR)/$(APP_NAME)

# Run release build
run-release: release
	$(RELEASE_DIR)/$(APP_NAME)

# Create .app bundle
bundle: release
	@echo "Creating application bundle..."
	@mkdir -p "$(BUNDLE_DIR)/Contents/MacOS"
	@mkdir -p "$(BUNDLE_DIR)/Contents/Resources"
	@cp "$(RELEASE_DIR)/$(APP_NAME)" "$(BUNDLE_DIR)/Contents/MacOS/$(APP_NAME)"
	@echo '<?xml version="1.0" encoding="UTF-8"?>' > "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '<plist version="1.0">' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '<dict>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>CFBundleExecutable</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>$(APP_NAME)</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>CFBundleIdentifier</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>com.agora.desktop</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>CFBundleName</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>Agora</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>CFBundleVersion</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>1.0.0</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>CFBundleShortVersionString</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>1.0.0</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>CFBundlePackageType</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>APPL</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>LSMinimumSystemVersion</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <string>13.0</string>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>NSHighResolutionCapable</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <true/>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <key>NSAppTransportSecurity</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  <dict>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '    <key>NSAllowsArbitraryLoads</key>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '    <true/>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '  </dict>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '</dict>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo '</plist>' >> "$(BUNDLE_DIR)/Contents/Info.plist"
	@echo "Application bundle created at $(BUNDLE_DIR)"

# Install to /Applications
install: bundle
	@echo "Installing Agora.app to /Applications..."
	@cp -R "$(BUNDLE_DIR)" /Applications/
	@echo "Installed successfully."

# Uninstall
uninstall:
	@echo "Removing Agora.app from /Applications..."
	@rm -rf /Applications/$(BUNDLE_NAME)
	@echo "Uninstalled."

# Clean build artifacts
clean:
	swift package clean
	rm -rf $(BUILD_DIR)

# Show help
help:
	@echo "Agora macOS Desktop Client"
	@echo ""
	@echo "Usage:"
	@echo "  make build       - Build debug version"
	@echo "  make release     - Build release version"
	@echo "  make run         - Build and run (debug)"
	@echo "  make run-release - Build and run (release)"
	@echo "  make bundle      - Create Agora.app bundle"
	@echo "  make install     - Install to /Applications"
	@echo "  make uninstall   - Remove from /Applications"
	@echo "  make clean       - Remove build artifacts"
