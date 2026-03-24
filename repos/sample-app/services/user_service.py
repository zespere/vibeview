from models.user import User


class UserService:
    def create_user(self, full_name: str, email: str) -> User:
        return User(full_name=full_name, email=email)
