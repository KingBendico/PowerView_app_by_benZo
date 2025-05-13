*** Please note: This app is a work in progress. Essentially, this is a beta version. More features and improvements will be added in the future. 

# PowerView App by BenZo

<img src="assets/PowerView.png" alt="PowerView Logo" width="256" height="256">

## Overview

PowerView App by BenZo is an open-source desktop application designed to control Hunter Douglas PowerView® blinds and scenes from your computer. The app allows you to manage blinds and scenes, view room groupings, and activate specific scenes through a user-friendly interface.

## Features

- **Blinds Control**: Adjust the positions of your blinds individually or in groups.
- **Scenes Management**: Activate and manage different scenes.
- **Room Grouping**: View and manage blinds grouped by room.
- **Settings Management**: Configure the IP address of your PowerView gateway manually, or scan your local network to automatically find and set up available PowerView gateways.

## Installation

To get started with PowerView App by BenZo, follow these steps:

1. **Clone the Repository**:
    ```sh
    git clone https://github.com/KingBendico/PowerView_App_by_BenZo.git
    cd PowerView_App_by_BenZo
    ```

2. **Install Dependencies**:
    ```sh
    npm install
    ```

3. **Start the Application**:
    ```sh
    npm start
    ```

## Usage

Upon starting the application, follow these steps to set it up:

1. **Open Settings**:
    - Click on the cogwheel icon (⚙️) in the top-right corner of the application window.
    
2. **Enter IP Address**:
    - In the settings window, enter the IP address of your PowerView gateway.
    - Click the "Save" button to store this information.

3. **Control Blinds and Scenes**:
    - Use the bottom navigation buttons to switch between blinds and scenes management.
    - Adjust blinds positions and activate scenes as needed.
  
## Packaging the App

### Prerequisites

1. **Node.js and npm**: Ensure you have Node.js and npm installed from [nodejs.org](https://nodejs.org/).

2. **Electron Packager**: Install Electron Packager globally:
    ```sh
    npm install -g electron-packager
    ```

### Steps to Package

1. **Navigate to your project directory**:
    ```sh
    cd PowerView_App_by_BenZo
    ```

2. **Install all dependencies**:
    ```sh
    npm install
    ```

3. **Package the Application**:
    - **Windows**:
      ```sh
      electron-packager . PowerViewApp --platform=win32 --arch=x64 --out=dist --overwrite
      ```
    - **macOS**:
      ```sh
      electron-packager . PowerViewApp --platform=darwin --arch=x64 --out=dist --overwrite
      ```
    - **Linux**:
      ```sh
      electron-packager . PowerViewApp --platform=linux --arch=x64 --out=dist --overwrite
      ```

## Files and Structure

- **index.html**: The main interface of the application.
- **settings.html**: The settings window for configuring the IP address.
- **style.css**: The stylesheet for the application.
- **main.js**: Main process of the Electron application.
- **preload.js**: Preload script for renderer processes.
- **renderer.js**: Renderer process script for the main interface.
- **ipFetcher.js**: Script for fetching the IP address from the local network.
- **package.json**: Node.js dependencies and scripts.
- **package-lock.json**: Lockfile for Node.js dependencies.

## Preview

<img src="https://github.com/KingBendico/PowerView_app_by_benZo/assets/29133994/c415ffdb-239e-4b11-82df-2ff616fef8ea" alt="Image 1" width="200" height="150">

<img src="https://github.com/KingBendico/PowerView_app_by_benZo/assets/29133994/3654adf7-a04b-498d-aebd-0e4d3337c091" alt="Image 2" width="200" height="150">

<img src="https://github.com/KingBendico/PowerView_app_by_benZo/assets/29133994/0c773185-9aa1-4342-a99b-7006e8128e9b" alt="Image 3" width="150" height="250">

## Development

To contribute to the development of PowerView App by BenZo, follow these steps:

1. **Fork the Repository**:
    - Click the "Fork" button on the GitHub repository page.

2. **Create a Branch**:
    ```sh
    git checkout -b feature-branch
    ```

3. **Make Changes**:
    - Implement your changes or new features.

4. **Commit and Push**:
    ```sh
    git commit -m "Description of changes"
    git push origin feature-branch
    ```

5. **Create a Pull Request**:
    - Go to the original repository on GitHub and create a pull request from your fork.

## License

This project is licensed under the MIT License.

## Disclaimer

PowerView is a trademark of Hunter Douglas/Luxaflex. This open-source project is made as a hobby and is not affiliated with or endorsed by Hunter Douglas/Luxaflex.

---

Enjoy using PowerView App by BenZo! For any issues or feature requests, please open an issue on the GitHub repository.
