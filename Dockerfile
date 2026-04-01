# Use Node.js version 18
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# NssApi folder ke andar se files copy karein
COPY NssApi/package*.json ./

# Install dependencies
RUN npm install

# Saara code NssApi folder se copy karein
COPY NssApi/ .

# Expose the port
EXPOSE 10000

# Start the application
CMD [ "node", "index.js" ]