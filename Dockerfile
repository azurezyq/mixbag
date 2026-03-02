# Use the official lightweight Node.js image.
FROM node:20-slim

# Set environment variables
ENV FIREBASE_DATABASE_ID=fairy

# Copy local code to the container image.
ENV APP_HOME=/app
WORKDIR $APP_HOME

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --production

# Copy the rest of the application
COPY . ./

# Validate EJS syntax before starting the server
RUN npm run validate-ejs

# Run the web service on container startup.
CMD ["node", "server.js"]
