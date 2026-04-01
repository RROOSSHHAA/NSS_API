# Use Node.js version 18
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package filesCOPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source code
COPY . .

# Expose the port (Koyeb usually uses 10000 or 8080)
EXPOSE 10000

# Start the application using index.js
CMD [ "node", "index.js" ]