# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Copy package.json and package-lock.json from root directory
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy the application code from Origin_Server
COPY Origin_Server/ .

RUN mkdir -p /app/movies && chmod 777 /app/movies

# Expose the port the app runs on
EXPOSE 4000

# Command to run the application
CMD ["node", "server.js"]