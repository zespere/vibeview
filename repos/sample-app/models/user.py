class User:
    def __init__(self, full_name: str, email: str) -> None:
        self.full_name = full_name
        self.email = email

    def display_name(self) -> str:
        return f"{self.full_name} <{self.email}>"
